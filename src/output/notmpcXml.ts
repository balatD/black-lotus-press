import type { Slot } from "../pipeline/packs.js";

// An order file in MPC Autofill's format, which the notmpc.eu designer imports. Slots count from 0.
export function notmpcXml(pack: Slot[], urls: Map<string, string>, cardBack: string): string {
    const url = (file: string) => {
        const found = urls.get(file);
        if (!found) throw new Error(`${file} was not uploaded to notmpc.eu`);
        return escape(found);
    };

    const fronts = new Map<string, number[]>();
    const backs = new Map<string, number[]>();
    pack.forEach((slot, index) => {
        fronts.set(slot.front, [...fronts.get(slot.front) ?? [], index]);
        if (slot.back !== cardBack) backs.set(slot.back, [...backs.get(slot.back) ?? [], index]);
    });

    const cards = (files: Map<string, number[]>) => [...files]
        .map(([file, slots]) => `    <card><id>${url(file)}</id><slots>${slots.join(',')}</slots></card>\n`)
        .join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<order>
  <fronts>
${cards(fronts)}  </fronts>
  <backs>
${cards(backs)}  </backs>
  <cardback>${url(cardBack)}</cardback>
</order>
`;
}

function escape(text: string) {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
