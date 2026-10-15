// Compiles the GPU temperature helper, which only exists for macOS.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

if (process.platform === 'darwin') {
    mkdirSync('build/native', { recursive: true });
    try {
        execFileSync('clang', ['-O2', '-framework', 'IOKit', '-o', 'build/native/gpu-temperature', 'native/gpu-temperature.c'], { stdio: 'inherit' });
    } catch {
        console.warn('Could not compile native/gpu-temperature.c (are the Xcode command line tools installed?). The app shows no GPU temperature.');
    }
}
