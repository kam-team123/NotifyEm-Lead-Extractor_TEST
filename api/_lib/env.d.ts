// The /api functions only need `process.env` from Node. Declaring it here (instead of listing "node"
// under tsconfig "types") keeps Vercel's per-function type check from failing with
// "TS2688: Cannot find type definition file for 'node'". Merges cleanly with @types/node when present.
declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
  }
  interface Process {
    env: ProcessEnv;
  }
}

declare var process: NodeJS.Process;
