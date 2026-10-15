export async function downloadDriveImage(id: string): Promise<Buffer> {
    const response = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`);
    const contentType = response.headers.get('content-type') ?? '';

    // Missing or private files come back as HTML pages, not as errors only.
    if (!response.ok || !contentType.startsWith('image/')) {
        throw new Error(`Google Drive image ${id} could not be downloaded (${response.status}, ${contentType}). Is it a public MPC Autofill image ID?`);
    }

    return Buffer.from(await response.arrayBuffer());
}
