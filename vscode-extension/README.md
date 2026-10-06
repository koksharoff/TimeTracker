# Time Tracker — VS Code Extension

Tracks your coding time, languages, projects and git commits, and reports them to a self-hosted [Time Tracker](https://github.com/koksh/TimeTracker) backend. Without a backend it still works: every event goes to a local log file.

## Features

- Active coding time per file, language and workspace, with idle detection
- Automatic commit tracking through VS Code's built-in Git extension
- GitHub username detected from the GitHub account signed in to VS Code; name from `git config user.name`
- Offline log at `~/.time-tracker/events.jsonl` (**Time Tracker: Open Local Log File**)

## Install

```bash
code --install-extension time-tracker-vscode-extension-0.2.0.vsix
```

Or in VS Code: Extensions view → `…` → **Install from VSIX…** → pick the file.

## Configure

```jsonc
{
  "timeTracker.backendUrl": "http://localhost:3000/events",
  "timeTracker.githubUsername": "your-github-login", // optional, auto-detected
  "timeTracker.displayName": "Your Name"             // optional, defaults to git user.name
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `timeTracker.enabled` | `true` | Turn tracking on or off |
| `timeTracker.backendUrl` | `""` | Events endpoint; empty = local log only |
| `timeTracker.intervalSeconds` | `60` | Heartbeat interval while active |
| `timeTracker.idleTimeoutSeconds` | `300` | Stop counting after this long without activity |
| `timeTracker.trackCommits` | `true` | Record your commits |
| `timeTracker.githubUsername` | `""` | GitHub login for avatar and links |
| `timeTracker.displayName` | `""` | Name shown on the dashboard |
| `timeTracker.token` | `""` | Bearer token for future multi-user backends |
| `timeTracker.logFilePath` | `""` | Custom local log path |

## Develop

```bash
npm install
npm test           # build + unit tests
npm run package    # build a .vsix
```

Press **F5** with this folder open to launch an Extension Development Host.

## Privacy

Events contain file paths, language IDs, workspace names, your OS username, hostname and (if available) GitHub login and git name. They are sent only to the `backendUrl` you configure.
