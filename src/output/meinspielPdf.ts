import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDict, PDFDocument, PDFHexString, type PDFImage, PDFName, PDFString } from "pdf-lib";
import type { OnProgress, Order, PackFiles } from "../model.js";
import { buildPacks, type DroppedToken, type Slot } from "../pipeline/packs.js";
import { cardsDir, orderDir } from "../config/paths.js";
import { exists } from "../utils/fs.js";
import { BLEED_MM, PAGE_HEIGHT_MM, PAGE_WIDTH_MM } from "./printImage.js";

const POINTS_PER_MM = 72 / 25.4;
const CREATOR = 'black-lotus-press';
const OUTPUT_CONDITION = 'ISO Coated v2 300% (ECI)';

export async function buildPdfs(order: Order, iccProfile: Uint8Array, onProgress?: OnProgress): Promise<{ packs: PackFiles[], droppedTokens: DroppedToken[] }> {
    const { packs, droppedTokens } = buildPacks(order);
    const dir = cardsDir(order);

    const files = new Set(packs.flat().flatMap(slot => [slot.front, slot.back]));
    const missing = [];
    for (const file of files) {
        if (!await exists(path.join(dir, file))) missing.push(file);
    }
    if (missing.length > 0) {
        throw new Error(`${missing.length} card image(s) are not processed yet. Process the images first.`);
    }

    return { packs: await writePacks(packs, dir, path.join(orderDir(order), 'meinspiel'), iccProfile, onProgress), droppedTokens };
}

export async function writePacks(packs: Slot[][], cardsDir: string, outputDir: string, iccProfile: Uint8Array, onProgress?: OnProgress): Promise<PackFiles[]> {
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });

    const files: PackFiles[] = [];
    const report = (done: number, message: string) => onProgress?.({ type: 'progress', done, total: packs.length * 2, message });
    for (const [index, pack] of packs.entries()) {
        const name = `pack-${String(index + 1).padStart(2, '0')}`;
        const fronts = path.join(outputDir, `${name}-fronts.pdf`);
        const backs = path.join(outputDir, `${name}-backs.pdf`);

        report(index * 2, `Writing the fronts of pack ${index + 1}`);
        await writePackPdf(pack.map(slot => path.join(cardsDir, slot.front)), iccProfile, fronts);
        report(index * 2 + 1, `Writing the backs of pack ${index + 1}`);
        await writePackPdf(pack.map(slot => path.join(cardsDir, slot.back)), iccProfile, backs);

        const bytes = (await fs.stat(fronts)).size + (await fs.stat(backs)).size;
        files.push({ fronts, backs, bytes });
    }

    return files;
}

export async function writePackPdf(pages: string[], iccProfile: Uint8Array, outputPath: string) {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const width = PAGE_WIDTH_MM * POINTS_PER_MM;
    const height = PAGE_HEIGHT_MM * POINTS_PER_MM;
    const bleed = BLEED_MM * POINTS_PER_MM;

    const images = new Map<string, PDFImage>();
    for (const file of pages) {
        let image = images.get(file);
        if (!image) {
            image = await doc.embedJpg(await fs.readFile(file));
            images.set(file, image);
        }

        const page = doc.addPage([width, height]);
        page.drawImage(image, { x: 0, y: 0, width, height });
        page.setBleedBox(0, 0, width, height);
        page.setTrimBox(bleed, bleed, width - 2 * bleed, height - 2 * bleed);
    }

    markForPrint(doc, iccProfile, path.basename(outputPath, '.pdf'));
    await fs.writeFile(outputPath, await doc.save());
}

// Output intent, Info and trailer ID. No XMP metadata: meinspiel.de's processing fails on any (HTTP 500 "pcntl_waitpid failed"),
// so the files cannot be PDF/X-4.
function markForPrint(doc: PDFDocument, iccProfile: Uint8Array, title: string) {
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    const documentId = randomUUID();

    doc.setTitle(title);
    doc.setCreator(CREATOR);
    doc.setProducer(CREATOR);
    doc.setCreationDate(now);
    doc.setModificationDate(now);
    doc.context.lookup(doc.context.trailerInfo.Info, PDFDict).set(PDFName.of('Trapped'), PDFName.of('False'));

    const id = PDFHexString.of(documentId.replaceAll('-', ''));
    doc.context.trailerInfo.ID = doc.context.obj([id, id]);

    const profile = doc.context.register(doc.context.flateStream(iccProfile, { N: 4 }));
    doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([doc.context.obj({
        Type: 'OutputIntent',
        S: 'GTS_PDFX',
        OutputConditionIdentifier: PDFString.of('FOGRA39'),
        OutputCondition: PDFString.of(OUTPUT_CONDITION),
        Info: PDFString.of(OUTPUT_CONDITION),
        RegistryName: PDFString.of('http://www.color.org'),
        DestOutputProfile: profile
    })]));
}
