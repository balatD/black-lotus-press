export const api = window.api;

// Errors from the main process arrive wrapped in "Error invoking remote method 'api': Error: ...".
export function errorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
}

// A task the user stopped ends with an abort error, which needs no message.
export function wasStopped(error: unknown) {
    return /aborted/i.test(errorMessage(error));
}
