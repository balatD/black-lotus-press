import { Listr } from "listr2";
import inquirer from "inquirer";
import chalk from "chalk";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { saveOrder } from "../config/orderConfigManager.js";
import { orderDir } from "../config/paths.js";
import { type OnProgress, type Order, type PackFiles, replaceDeckCards } from "../model.js";
import { importDeck } from "../pipeline/importDecks.js";
import { processImages } from "../pipeline/processImages.js";
import { MAX_UPLOAD_BYTES } from "../pipeline/packs.js";
import { buildPdfs } from "../output/meinspielPdf.js";
import { ensureIccProfile } from "../output/iccProfile.js";
import { MANUAL_UPLOAD_URL, type MeinspielSession, uploadToMeinspiel } from "../clients/meinspiel.js";
import { ui } from "../ui/theme.js";
import { confirmDialog } from "../utils/dialog.js";

export async function processOrder(order: Order) {
    console.clear();
    console.log(ui.title(`Processing Order: ${order.name}`));
    console.log('Downloading and post-processing your card images before upscaling and creating the print PDFs for meinspiel.de.\n');

    try {
        await importMissingDecks(order);
        if (!await confirmWarnings(order)) {
            throw new Error('Order processing cancelled by user');
        }

        const iccProfile = await ensureIccProfile();
        await runTask('Processing card images', onProgress => processImages(order, iccProfile, onProgress));
        const { packs, droppedTokens } = await runTask('Creating meinspiel.de PDFs', async onProgress => buildPdfs(order, await readFile(iccProfile), onProgress));

        if (droppedTokens.length > 0) {
            const names = droppedTokens.map(token => token.copies > 1 ? `${token.card.name} ×${token.copies}` : token.card.name);
            console.log(ui.attention(`Token(s) left out because they would need an extra pack: ${names.join(', ')}`));
        }

        packs.filter(pack => pack.bytes > MAX_UPLOAD_BYTES).forEach(pack => {
            console.log(ui.attention(`${pack.fronts} and its backs exceed the 200 MB upload limit of meinspiel.de. Lower the DPI in your processing profile.`));
        });

        console.log('\n' + ui.success(`Order processing complete. ${packs.length} pack(s) of 55 cards, PDFs at ${path.join(orderDir(order), 'meinspiel')}`));

        if (packs.length > 0 && await confirmDialog(`Upload ${packs.length} pack(s) to meinspiel.de now? This confirms you followed their design and PDF guidelines.`, true)) {
            await upload(order, packs);
        }
    } catch (err) {
        console.error('\n' + ui.error('An error occurred:'), err);
    }

    if (await confirmDialog('\nDo you want to exit the application?', true)) {
        process.exit(0);
    }
}

async function importMissingDecks(order: Order) {
    const decks = order.decks.filter(deck => !order.cards.some(card => card.deck === deck.url));

    for (const deck of decks) {
        const { name, cards } = await runTask(`Loading ${chalk.green(deck.url)}`, onProgress => importDeck(deck, order.profile.playwrightChannel, onProgress));
        deck.name = name;
        order.cards = replaceDeckCards(order.cards, deck.url, cards);
        await saveOrder(order);
    }
}

async function confirmWarnings(order: Order) {
    const cards = order.cards.filter(card => !card.excluded);

    const missing = cards.filter(card => !card.printing && !card.customImage);
    if (missing.length > 0) {
        console.log(ui.attention(`The following cards were not found on Scryfall and will be skipped:`));
        missing.forEach(card => console.log(`- ${card.name}`));

        console.log(ui.information('You can still process the order, but some images will be missing.'));
        if (!await confirmDialog('Do you want to process the order anyway?', true)) return false;
    }

    const lowRes = cards.filter(card => !card.customImage && card.printing?.image_status === 'lowres');
    if (lowRes.length > 0) {
        console.log(ui.attention(`The following cards are reported by Scryfall as low-resolution:`));
        lowRes.forEach(card => console.log(`- ${card.printing!.name} (${card.printing!.set.toUpperCase()} ${card.printing!.collector_number})`));

        console.log(ui.information('You can still process the order, but the proxy quality of these images may be lower than expected.'));
        if (!await confirmDialog('Do you want to process the order anyway?', true)) return false;
    }

    return true;
}

async function upload(order: Order, packs: PackFiles[]) {
    let session: MeinspielSession | undefined;

    try {
        const result = await runTask('Uploading to meinspiel.de', onProgress => uploadToMeinspiel(order.name, packs, order.profile.playwrightChannel, onProgress));
        session = result.session;

        console.log('\n' + ui.success(`Uploaded ${result.games.length} deck(s) to your meinspiel.de account under "Gestaltete Spiele". Each one is open in its own browser tab.`));
        result.games.forEach(game => console.log(`${game.name}: ${game.url}`));
        result.games.filter(game => !game.saved).forEach(game => {
            console.log(ui.attention(`"${game.name}" is not saved in your account. Click "Speichern" in its tab before closing the browser.`));
        });
        console.log(ui.information('To order, click "Speichern / Bestellen" in every tab, choose the box and check out.'));
        await inquirer.prompt([{ type: 'input', name: 'done', message: 'Press Enter to close the browser.' }]);
    } catch (err) {
        console.error('\n' + ui.error('Upload failed:'), err);
        console.log(ui.information(`You can upload the PDFs from ${path.dirname(packs[0]!.fronts)} manually at ${MANUAL_UPLOAD_URL}`));
    } finally {
        await session?.browser.close();
    }
}

// Shows a core step as a Listr task: the counter goes into the title, the latest message below it.
async function runTask<T>(title: string, work: (onProgress: OnProgress) => Promise<T>): Promise<T> {
    let result: T | undefined;

    await new Listr([{
        title,
        task: async (_ctx, task) => {
            result = await work(event => {
                if (event.type !== 'progress') return;
                task.title = event.total > 0 ? `${title} (${event.done}/${event.total})` : title;
                task.output = event.message;
            });
        }
    }]).run();

    return result as T;
}
