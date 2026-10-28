import { spawn } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** spawn with timeout, output capture (bounded) and abort support. Never uses a shell. */
export function exec(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal; onStderr?: (s: string) => void; maxBuffer?: number } = {}): Promise<ExecResult> {
  const max = opts.maxBuffer ?? 8 * 2 ** 20;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      if (out.length < max) out += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      opts.onStderr?.(s);
      if (err.length < max) err += s;
      else err = err.slice(-max / 2) + s;
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 5000).unref();
        }, opts.timeoutMs)
      : null;
    const onAbort = () => child.kill("SIGTERM");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code: code ?? -1, stdout: out, stderr: err });
    });
  });
}

export async function execOk(cmd: string, args: string[], opts: Parameters<typeof exec>[2] = {}): Promise<ExecResult> {
  const r = await exec(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${cmd} ${args.slice(0, 6).join(" ")} … exited ${r.code}\n${r.stderr.slice(-4000)}`);
  return r;
}
