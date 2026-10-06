import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ExtensionContext } from 'vscode';
import type * as vscodeTypes from 'vscode';

type VscodeAPI = typeof import('vscode');

const vscode: VscodeAPI = (() => {
  try {
    return require('vscode');
  } catch {
    return {
      workspace: {
        getConfiguration: () => ({ get: () => undefined }),
        onDidChangeTextDocument: () => ({ dispose: () => {} }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        getWorkspaceFolder: () => null,
        openTextDocument: () => Promise.resolve({} as any),
      },
      window: {
        activeTextEditor: null,
        state: { focused: false },
        onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
        onDidChangeWindowState: () => ({ dispose: () => {} }),
        showInformationMessage: (() => {}) as any,
        showTextDocument: () => Promise.resolve({} as any),
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
      },
      authentication: {
        getSession: () => Promise.resolve(undefined),
        onDidChangeSessions: () => ({ dispose: () => {} }),
      },
      extensions: {
        getExtension: () => undefined,
      },
      Uri: {
        file: (value: string) => ({ fsPath: value }),
      },
    } as unknown as typeof vscodeTypes;
  }
})();

// Text changes fire on every keystroke; record at most one such event per interval.
const DOCUMENT_CHANGE_THROTTLE_MS = 30 * 1000;

let heartbeatTimer: NodeJS.Timeout | undefined;

interface FileInfo {
  path: string;
  language: string;
  fileName: string;
  workspaceFolder: string | null;
}

interface CommitInfo {
  hash: string;
  repository: string;
  branch: string | null;
  message: string;
  authoredAt: string;
}

interface TrackingEvent {
  event: string;
  timestamp: string;
  elapsedMs: number;
  activeTimeMs: number;
  file: FileInfo | null;
  session: {
    hostname: string;
    user: string;
    startedAt: string;
    githubLogin: string | null;
    displayName: string | null;
  };
  commit?: CommitInfo;
}

// Minimal subset of the built-in `vscode.git` extension API (see extensions/git/src/api/git.d.ts).
interface GitCommit {
  hash: string;
  message: string;
  parents: string[];
  authorDate?: Date;
  authorEmail?: string;
}

interface GitRepository {
  rootUri: { fsPath: string };
  state: {
    HEAD: { name?: string; commit?: string } | undefined;
    onDidChange: (listener: () => void) => vscodeTypes.Disposable;
  };
  getCommit(ref: string): Promise<GitCommit>;
  getConfig(key: string): Promise<string>;
  getGlobalConfig(key: string): Promise<string>;
}

interface GitAPI {
  repositories: GitRepository[];
  onDidOpenRepository: (listener: (repo: GitRepository) => void) => vscodeTypes.Disposable;
}

const sessionState = {
  startTime: new Date(),
  lastHeartbeatAt: 0 as number,
  lastActivityAt: Date.now(),
  lastDocumentChangeEventAt: 0 as number,
  currentFilePath: null as string | null,
  activeTimeByFile: {} as Record<string, number>,
};

const profile = {
  githubLogin: null as string | null,
  gitUserName: null as string | null,
};

function getConfig() {
  return vscode.workspace.getConfiguration('timeTracker');
}

function ensureLogDirectory() {
  const logDirectory = path.join(os.homedir(), '.time-tracker');
  fs.mkdirSync(logDirectory, { recursive: true });
  return logDirectory;
}

export function getEventLogPath(): string {
  const config = getConfig();
  const overridePath = config.get<string>('logFilePath');
  if (overridePath) {
    return overridePath;
  }
  return path.join(ensureLogDirectory(), 'events.jsonl');
}

function getActiveFileInfo(): FileInfo | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }

  const document = editor.document;
  return {
    path: document.uri.fsPath,
    language: document.languageId,
    fileName: document.fileName,
    workspaceFolder: vscode.workspace.getWorkspaceFolder(document.uri)?.name || null,
  };
}

function getSessionUser(): string {
  return process.env.USER || process.env.USERNAME || os.userInfo().username || 'unknown';
}

// Explicit settings win over auto-detected values (VS Code GitHub account, git config).
export function resolveProfile(): { githubLogin: string | null; displayName: string | null } {
  const config = getConfig();
  const githubLogin = config.get<string>('githubUsername')?.trim() || profile.githubLogin;
  const displayName = config.get<string>('displayName')?.trim() || profile.gitUserName;
  return { githubLogin: githubLogin || null, displayName: displayName || null };
}

export function createTrackingEvent(
  fileInfo: FileInfo | null,
  eventType = 'heartbeat',
  elapsedMs = 0
): TrackingEvent {
  const filePath = fileInfo?.path ?? null;
  const fileActiveTimeMs = filePath ? sessionState.activeTimeByFile[filePath] || 0 : 0;

  return {
    event: eventType,
    timestamp: new Date().toISOString(),
    elapsedMs,
    activeTimeMs: fileActiveTimeMs,
    file: fileInfo,
    session: {
      hostname: os.hostname(),
      user: getSessionUser(),
      startedAt: sessionState.startTime.toISOString(),
      ...resolveProfile(),
    },
  };
}

function persistEvent(payload: TrackingEvent): string {
  const logPath = getEventLogPath();
  fs.appendFileSync(logPath, `${JSON.stringify(payload)}\n`, 'utf8');
  return logPath;
}

function sendPayload(payload: TrackingEvent): Promise<void> {
  const config = getConfig();
  const endpoint = config.get<string>('backendUrl');
  const token = config.get<string>('token');

  if (!endpoint) {
    return Promise.resolve();
  }

  const data = JSON.stringify(payload);
  const url = new URL(endpoint);
  const client = url.protocol === 'https:' ? https : http;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data).toString(),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return new Promise((resolve) => {
    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers,
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      }
    );

    req.on('error', () => resolve());
    req.write(data);
    req.end();
  });
}

function emit(payload: TrackingEvent): void {
  persistEvent(payload);
  sendPayload(payload).catch(() => {});
}

function isIdle(now: number): boolean {
  const idleTimeoutSeconds = getConfig().get<number>('idleTimeoutSeconds') ?? 300;
  return now - sessionState.lastActivityAt > idleTimeoutSeconds * 1000;
}

function trackHeartbeat(eventType = 'heartbeat'): void {
  const config = getConfig();
  if (!config.get<boolean>('enabled')) {
    return;
  }

  const now = Date.now();
  const previousHeartbeatAt = sessionState.lastHeartbeatAt || now;
  sessionState.lastHeartbeatAt = now;

  // While idle, timer heartbeats are skipped and the gap is dropped, so only
  // time spent actually working in the editor is reported.
  if (eventType === 'heartbeat' && isIdle(now)) {
    return;
  }

  const elapsedMs = Math.max(0, now - previousHeartbeatAt);
  const fileInfo = getActiveFileInfo();

  if (sessionState.currentFilePath) {
    const previousPath = sessionState.currentFilePath;
    sessionState.activeTimeByFile[previousPath] = (sessionState.activeTimeByFile[previousPath] || 0) + elapsedMs;
  }
  sessionState.currentFilePath = fileInfo?.path ?? null;

  emit(createTrackingEvent(fileInfo, eventType, elapsedMs));
}

function markActivity(): void {
  const now = Date.now();
  const wasIdle = isIdle(now);
  sessionState.lastActivityAt = now;
  if (wasIdle) {
    // Do not count the idle gap that just ended.
    sessionState.lastHeartbeatAt = now;
  }
}

function openLogFile(): void {
  const logPath = getEventLogPath();
  if (!fs.existsSync(logPath)) {
    vscode.window.showInformationMessage('No tracking events have been saved yet.');
    return;
  }

  const uri = vscode.Uri.file(logPath);
  vscode.workspace.openTextDocument(uri).then((document) => {
    vscode.window.showTextDocument(document);
  });
}

async function detectGithubLogin(): Promise<void> {
  try {
    // `silent: true` never prompts; it only reuses an account already signed in to VS Code.
    const session = await vscode.authentication.getSession('github', ['read:user'], { silent: true });
    profile.githubLogin = session?.account.label ?? null;
  } catch {
    profile.githubLogin = null;
  }
}

export function isNewLocalCommit(
  previousHead: { name?: string; commit?: string } | undefined,
  commit: Pick<GitCommit, 'parents' | 'authorEmail'>,
  currentBranch: string | undefined,
  userEmail: string | null
): boolean {
  if (!previousHead?.commit || previousHead.name !== currentBranch) {
    return false; // branch switch or first observation
  }
  if (!commit.parents.includes(previousHead.commit)) {
    return false; // checkout, reset, rebase or a multi-commit pull
  }
  if (userEmail && commit.authorEmail && commit.authorEmail.toLowerCase() !== userEmail.toLowerCase()) {
    return false; // someone else's commit arriving via fast-forward pull
  }
  return true;
}

function watchRepository(repo: GitRepository, context: ExtensionContext): void {
  let previousHead = repo.state.HEAD ? { ...repo.state.HEAD } : undefined;

  if (!profile.gitUserName) {
    repo.getConfig('user.name')
      .catch(() => '')
      .then((name) => name || repo.getGlobalConfig('user.name'))
      .then((name) => {
        profile.gitUserName = name?.trim() || profile.gitUserName;
      })
      .catch(() => {});
  }

  const subscription = repo.state.onDidChange(async () => {
    const head = repo.state.HEAD;
    const lastHead = previousHead;
    previousHead = head ? { ...head } : undefined;

    if (!head?.commit || head.commit === lastHead?.commit) {
      return;
    }
    if (!getConfig().get<boolean>('enabled') || getConfig().get<boolean>('trackCommits') === false) {
      return;
    }

    try {
      const commit = await repo.getCommit(head.commit);
      const userEmail = await repo.getConfig('user.email').catch(() => '');
      if (!isNewLocalCommit(lastHead, commit, head.name, userEmail || null)) {
        return;
      }

      const payload = createTrackingEvent(getActiveFileInfo(), 'commit', 0);
      payload.commit = {
        hash: commit.hash,
        repository: path.basename(repo.rootUri.fsPath),
        branch: head.name ?? null,
        message: commit.message.split('\n')[0] ?? '',
        authoredAt: (commit.authorDate ?? new Date()).toISOString(),
      };
      emit(payload);
    } catch (error) {
      console.error('Time Tracker: failed to record commit', error);
    }
  });

  context.subscriptions.push(subscription);
}

function setupGitTracking(context: ExtensionContext): void {
  const gitExtension = vscode.extensions.getExtension<{ getAPI(version: 1): GitAPI }>('vscode.git');
  if (!gitExtension) {
    return;
  }

  const init = () => {
    const api = gitExtension.exports.getAPI(1);
    api.repositories.forEach((repo) => watchRepository(repo, context));
    context.subscriptions.push(api.onDidOpenRepository((repo) => watchRepository(repo, context)));
  };

  if (gitExtension.isActive) {
    init();
  } else {
    gitExtension.activate().then(init, () => {});
  }
}

function setupListeners(context: ExtensionContext): void {
  const onDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor(() => {
    markActivity();
    trackHeartbeat('file_changed');
  });

  const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.uri.scheme !== 'file' && event.document.uri.scheme !== 'untitled') {
      return; // ignore output panels, git views, etc.
    }
    markActivity();
    const now = Date.now();
    if (now - sessionState.lastDocumentChangeEventAt >= DOCUMENT_CHANGE_THROTTLE_MS) {
      sessionState.lastDocumentChangeEventAt = now;
      trackHeartbeat('document_changed');
    }
  });

  const onDidChangeWindowState = vscode.window.onDidChangeWindowState((state) => {
    if (state.focused) {
      markActivity();
    }
  });

  const onDidChangeSessions = vscode.authentication.onDidChangeSessions((event) => {
    if (event.provider.id === 'github') {
      detectGithubLogin();
    }
  });

  const openLogCommand = vscode.commands.registerCommand('timeTracker.openLogFile', openLogFile);
  context.subscriptions.push(
    onDidChangeActiveTextEditor,
    onDidChangeTextDocument,
    onDidChangeWindowState,
    onDidChangeSessions,
    openLogCommand
  );
}

export function activate(context: ExtensionContext): void {
  setupListeners(context);
  setupGitTracking(context);
  detectGithubLogin().finally(() => trackHeartbeat('session_started'));

  const intervalSeconds = getConfig().get<number>('intervalSeconds') ?? 60;
  heartbeatTimer = setInterval(() => trackHeartbeat('heartbeat'), intervalSeconds * 1000);

  console.log('Time Tracker extension activated');
}

export function deactivate(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
}
