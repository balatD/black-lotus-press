import { LifeBuoy } from "lucide-react";
import type { Order, Shop } from "../../../../src/model.js";

const TITLES = ['Create an order', 'Add your deck', 'Check the cards', 'Print'];

export interface GuideStep {
    number: number;
    text: string;
    // The data-guide value of the controls the step is about, which the guide highlights.
    target: 'create' | 'name' | 'deck' | 'importing' | 'setup' | 'next' | 'handover';
}

const HANDOVER: Record<Shop, string> = {
    meinspiel: 'Process images and upload makes the print images and uploads them. Log in to meinspiel.de in the window that opens; the app never sees your password. Then choose the box and order there.',
    printerstudio: 'Process the images, then Send to printerstudio.de fills their designer. Log in there, check the preview and put the decks into the cart.',
    home: 'Process the images, then Print… or Save PDF. Print at actual size (100 %), not fit to page, so the cards come out at their real size.'
};

export function startStep(creating: boolean): GuideStep {
    return creating
        ? { number: 1, text: 'Give it a name, such as the deck\'s, and click Create order.', target: 'name' }
        : { number: 1, text: 'An order holds the decks you print together. Start one with the highlighted button.', target: 'create' };
}

export function orderStep(order: Order, tab: 'Setup' | 'Cards' | 'Print', importing: boolean): GuideStep {
    if (order.cards.length === 0) {
        if (tab !== 'Setup') return { number: 2, text: 'The decks go in on the Setup tab.', target: 'setup' };
        if (importing) {
            return { number: 2, target: 'importing', text: order.tcg === 'magic'
                ? 'The app loads the deck and looks up its cards. A Moxfield deck opens in a browser window, which closes by itself.'
                : 'The app looks up the cards of the list.' };
        }
        return { number: 2, target: 'deck', text: order.tcg === 'magic'
            ? 'Paste the link of a Moxfield or Archidekt deck, tick the boards to print and click Add and import.'
            : 'Paste the deck list and click Add and import.' };
    }
    if (tab === 'Setup') {
        return { number: 3, target: 'next', text: `The deck is in. ${order.tcg === 'magic' ? 'The card back and the profile' : 'The profile'} below can stay as they are for now. Go on to the cards.` };
    }
    if (tab === 'Cards') {
        return { number: 3, target: 'next', text: 'These are the cards that print. Click one to pick another printing or image, or untick Print to leave it out. Then go on to printing.' };
    }
    return { number: 4, text: HANDOVER[order.shop], target: 'handover' };
}

export function Guide({ step, onOff }: { step: GuideStep, onOff(): void }) {
    const last = step.number === TITLES.length;

    return (
        <aside className="guide" data-target={step.target} aria-label="Guide" aria-live="polite">
            <p className="guide-step"><LifeBuoy/>Step {step.number} of {TITLES.length}</p>
            <h2>{TITLES[step.number - 1]}</h2>
            <p>{step.text}</p>
            <button className={last ? 'primary' : 'quiet'} onClick={onOff}>{last ? 'Finish the guide' : 'Turn off the guide'}</button>
        </aside>
    );
}
