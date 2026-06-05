/**
 * Frees the theme app extension dev port (9293) if a previous
 * `shopify app dev` session was not stopped cleanly.
 */
import { execSync } from "node:child_process";

const PORT = process.env.THEME_APP_EXTENSION_PORT ?? "9293";

function freePortWindows(port) {
  let output = "";
  try {
    output = execSync(`netstat -ano | findstr ":${port}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return;
  }

  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const pid = line.trim().split(/\s+/).at(-1);
    if (pid && pid !== "0") pids.add(pid);
  }

  for (const pid of pids) {
    console.log(`Freeing port ${port} (PID ${pid})...`);
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "inherit" });
    } catch {
      // Process may have already exited.
    }
  }
}

function freePortUnix(port) {
  try {
    execSync(`lsof -ti:${port} | xargs -r kill -9`, {
      stdio: "inherit",
      shell: true,
    });
  } catch {
    // Port not in use.
  }
}

if (process.platform === "win32") {
  freePortWindows(PORT);
} else {
  freePortUnix(PORT);
}
