# RGB Fighters

A React + Vite web app.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- npm (comes with Node.js)

## Building on Windows

Open **Command Prompt** or **PowerShell**, navigate to the project folder, and run:

```powershell
# Install dependencies
npm install

# Start the development server (hot reload)
npm run dev

# Build for production
npm run build

# Preview the production build locally
npm run preview
```

The dev server will be available at `http://localhost:5173` by default.

## Building in VS Code on Windows

1. Open the project folder in VS Code: **File > Open Folder** and select the `rgb-fighters` directory.
2. Open the integrated terminal: **Ctrl+`** (backtick) or **Terminal > New Terminal**.
3. In the terminal, run the same commands as above:

```powershell
npm install
npm run dev
```

4. Hold **Ctrl** and click the `http://localhost:5173` URL printed in the terminal to open it in your browser.

**Recommended VS Code extensions:**
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) — highlights lint errors inline
- [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) — code formatting
- [vscode-icons](https://marketplace.visualstudio.com/items?itemName=vscode-icons-team.vscode-icons) — file icons for easier navigation

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Build for production (output in `dist/`) |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint |