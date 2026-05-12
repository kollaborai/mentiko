# Code Editor

built-in file editor - browse and edit workspace files directly from the web UI.

---

## Overview

The code editor provides a VS Code-like editing experience directly in your browser. Browse files, edit code, and save changes to your workspace without leaving the Mentiko interface.

**Key benefits:**
- Quick edits to chain configurations, agent scripts, and workspace files
- Syntax highlighting for 100+ languages
- Split-pane editing with multiple files
- Search across all files in workspace
- Git integration shows unsaved changes

---

## Accessing the Code Editor

### From the Sidebar

Click the **Code** icon (folder with angle brackets) in the left sidebar to open the editor.

### Direct URL

Navigate to `/code` in your browser when logged in.

---

## Interface Overview

The editor has three main areas:

**Sidebar (left)**
- File explorer - navigate workspace tree
- Search panel - find text across files
- Settings - editor preferences

**Main Content (center)**
- Tabbed editor - open multiple files
- Split panes - view files side-by-side
- Line numbers, syntax highlighting

**Status Bar (bottom)**
- File path
- Line/column position
- Unsaved changes indicator

---

## File Browser

### Navigation

1. Expand folders by clicking the arrow or double-clicking
2. Click file names to open them in the editor
3. Use the breadcrumb trail to see current path

### Keyboard Shortcuts

- `Cmd+P` / `Ctrl+P` - Quick open (search files by name)
- `Cmd+Shift+F` / `Ctrl+Shift+F` - Search across all files

### File Icons

The file tree shows icons for common file types:
- `.json` - Chain definitions
- `.sh` - Bash scripts
- `.ts` / `.tsx` - TypeScript files
- `.md` - Markdown documentation
- And 100+ other languages

---

## Editing Files

### Opening Files

Click any file in the file browser to open it in a new tab. Multiple files can be open simultaneously.

### Making Changes

Simply type in the editor to make changes. The editor supports:

- Syntax highlighting
- Auto-indentation
- Bracket matching
- Multi-cursor editing (Cmd+Click / Ctrl+Click)

### Saving Changes

Press `Cmd+S` / `Ctrl+S` to save the current file. The file is written to your workspace immediately.

**Unsaved Changes Indicator**

Files with unsaved changes show a dot (•) in the tab name. The tab also highlights to show pending changes.

### Split View

Click the split icon in the top-right to divide the editor into two panes. Drag files between panes to compare files side-by-side.

---

## Search Panel

Open the search panel by clicking the magnifying glass icon in the sidebar header or pressing `Cmd+Shift+F` / `Ctrl+Shift+F`.

**Features:**
- Search text across all files in workspace
- Case-sensitive toggle
- Regex support
- Replace all functionality

---

## Editor Settings

Click the gear icon in the sidebar header to configure editor preferences:

**Options:**
- Theme - Match system, light, or dark
- Font size - Adjust text size (12-24px)
- Tab size - 2 or 4 spaces
- Word wrap - Toggle line wrapping
- Minimap - Show code overview on right

---

## Git Integration

The editor shows git status for files in the workspace:

**Indicators:**
- `M` - Modified (yellow)
- `A` - Added (green)
- `D` - Deleted (red)
- `??` - Untracked (gray)

### Viewing Git Diff

Click a file with changes to see a diff view showing:
- Removed lines (red background)
- Added lines (green background)
- Context lines (no highlight)

---

## Examples

### Quick Edit to Chain Configuration

1. Open `/code` in the browser
2. Navigate to `chains/my-chain/chain.json`
3. Edit agent settings or config options
4. Press `Cmd+S` / `Ctrl+S` to save
5. Chain updates immediately - no redeploy needed

### Review Agent Script in Browser

1. Navigate to `agents/` folder in file browser
2. Click `my-agent.sh` to open
3. Use `Cmd+F` / `Ctrl+F` to search within the file
4. Read through the script with syntax highlighting
5. Make edits if needed and save

### Compare Two Chain Versions

1. Open first chain file in left pane
2. Click split icon to enable split view
3. Open second chain file in right pane
4. Compare agent configurations side-by-side

---

## Troubleshooting

### "Could not resolve project root"

**Cause:** The code editor cannot access the workspace directory.

**Solution:**
```bash
# Check the workspace path in settings
cd $MENTIKO_CODE_ROOT
cat namespaces/default/projects/*/workspace.json

# Verify the directory exists and is readable
ls -la ~/.mentiko/namespaces/default/projects/
```

### File Changes Not Saving

**Symptoms:** Changes disappear after refreshing the page.

**Causes & Solutions:**

1. **Permission denied**
   ```bash
   # Check file permissions
   ls -la path/to/file.sh

   # Fix permissions if needed
   chmod 644 path/to/file.sh
   ```

2. **Disk full**
   ```bash
   # Check disk space
   df -h

   # Clean up if needed
   rm -rf ~/.mentiko/namespaces/default/projects/*/runs/*
   ```

### Syntax Highlighting Not Working

**Cause:** File extension not recognized.

**Solution:** The editor auto-detects language by file extension. Ensure files have correct extensions (`.ts`, `.json`, `.sh`, etc.). For files without extensions, the editor falls back to plain text.

---

## File API

The code editor uses these API endpoints:

### Read File

```http
GET /api/code/read?path=chains/my-chain/chain.json
```

**Response:**
```json
{
  "content": "{\"agents\": [...]}",
  "encoding": "utf8"
}
```

### Write File

```http
POST /api/code/write
Content-Type: application/json
```

**Request:**
```json
{
  "path": "chains/my-chain/chain.json",
  "content": "{\"agents\": [...]}"
}
```

**Response:**
```json
{
  "success": true
}
```

### List Directory

```http
GET /api/code/list?path=chains
```

**Response:**
```json
{
  "entries": [
    {"name": "my-chain", "type": "directory"},
    {"name": "agent.json", "type": "file"}
  ]
}
```

---

## Limitations

- Max file size: 10 MB for editing
- Binary files: Read-only (shows hex view)
- Large directories: First 1000 entries shown
- Workspace: Must be within the configured project root

---

## Security

The code editor enforces workspace boundaries:

- Files outside the project root cannot be accessed
- Symbolic links are resolved and checked against boundaries
- File operations use the same permissions as the web server

**Note:** Files are written with the permissions of the Mentiko web server process. Ensure the process has write access to your workspace.

---

## Related Features

- **Workspaces** - Configure local, SSH, or Docker execution environments
- **Chains** - Edit chain JSON files directly
- **Agents** - Modify agent scripts and configurations
- **Templates** - Browse and customize chain templates
