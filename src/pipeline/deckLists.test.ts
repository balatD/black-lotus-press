import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { type DeckConfig, DeckData } from "../model.js";
import { importDeckList, parseLorcanaList, parseOnePieceList, parsePtcgl, parseYgoList, searchTcgCards } from "./deckLists.js";

afterEach(() => mock.restoreAll());

function ydke(...sections: number[][]) {
    return 'ydke://' + sections.map(passcodes => {
        const bytes = Buffer.alloc(passcodes.length * 4);
        passcodes.forEach((passcode, index) => bytes.writeUInt32LE(passcode, index * 4));
        return bytes.toString('base64');
    }).join('!') + '!';
}

test('parseYgoList counts the copies of a .ydk list per section and reports the lines it cannot read', () => {
    const list = ['#created by EDOPro', '#main', '89631139', '89631139', '46986414', '', '#extra', '01861629', '!side', '14558127', 'Ash Blossom'].join('\n');

    assert.deepEqual(parseYgoList(list), {
        entries: [
            { board: DeckData.MainBoard, passcode: 89631139, quantity: 2 },
            { board: DeckData.MainBoard, passcode: 46986414, quantity: 1 },
            { board: DeckData.Extra, passcode: 1861629, quantity: 1 },
            { board: DeckData.SideBoard, passcode: 14558127, quantity: 1 }
        ],
        unknown: ['Ash Blossom']
    });
});

test('parseYgoList reads a ydke:// link, whose sections are base64 passcodes', () => {
    assert.deepEqual(parseYgoList(` ${ydke([89631139, 89631139], [1861629], [])} `).entries, [
        { board: DeckData.MainBoard, passcode: 89631139, quantity: 2 },
        { board: DeckData.Extra, passcode: 1861629, quantity: 1 }
    ]);
    assert.deepEqual(parseYgoList('ydke://abc!!!').unknown, ['ydke://abc!!!']);
});

test('parsePtcgl reads a Pokémon TCG Live export, adds up repeated cards and leaves out the section totals', () => {
    const list = [
        'Pokémon: 2', '4 Charizard ex OBF 125', '1 Pikachu PR-SV 27', '',
        'Trainer: 1', '4 Ultra Ball SVI 196', '1 Ultra Ball SVI 196',
        'Energy: 2', '8 Basic {R} Energy SVE 2', '4 Basic Fire Energy', '3 Water Energy',
        'Total Cards: 60', 'Charizard without a count'
    ].join('\n');

    assert.deepEqual(parsePtcgl(list), {
        entries: [
            { quantity: 4, name: 'Charizard ex', set: 'OBF', number: '125' },
            { quantity: 1, name: 'Pikachu', set: 'PR-SV', number: '27' },
            { quantity: 5, name: 'Ultra Ball', set: 'SVI', number: '196' },
            { quantity: 12, name: 'Fire Energy', set: 'SVE', number: '2' },
            { quantity: 3, name: 'Water Energy', set: 'SVE', number: '3' }
        ],
        unknown: ['Charizard without a count']
    });
});

const ygoCard = (id: number, name: string, ...artworks: number[]) => ({
    id, name, type: 'Effect Monster', card_images: [id, ...artworks].map(art => ({ id: art, image_url: `https://images.ygoprodeck.com/images/cards/${art}.jpg` }))
});

test('importDeckList looks up a Yu-Gi-Oh list in one request, keeps the artwork it names and leaves out sections that are not ticked', async () => {
    const urls: string[] = [];
    mock.method(globalThis, 'fetch', async (url: string) => {
        urls.push(url);
        return Response.json({ data: [ygoCard(89631139, 'Blue-Eyes White Dragon'), { ...ygoCard(46986414, 'Dark Magician'), card_images: [{ id: 46986415, image_url: 'https://images.ygoprodeck.com/images/cards/46986415.jpg' }] }] });
    });
    const deck: DeckConfig = { url: 'list:1', data: [DeckData.MainBoard, DeckData.Extra], list: ['#main', '89631139', '89631139', '46986415', '12345678', '!side', '14558127'].join('\n') };

    const { cards, notes } = await importDeckList(deck, 'yugioh', 'en');

    assert.deepEqual(urls, ['https://db.ygoprodeck.com/api/v7/cardinfo.php?id=89631139,46986415,12345678']);
    assert.deepEqual(cards.map(card => [card.board, card.name, card.quantity, card.tcgCard, card.imported]), [
        ['mainboard', 'Blue-Eyes White Dragon', 2, { tcg: 'yugioh', id: 89631139, image: 'https://images.ygoprodeck.com/images/cards/89631139.jpg' }, { moxfieldId: '89631139', quantity: 2, printingId: '89631139' }],
        ['mainboard', 'Dark Magician', 1, { tcg: 'yugioh', id: 46986415, image: 'https://images.ygoprodeck.com/images/cards/46986415.jpg' }, { moxfieldId: '46986415', quantity: 1, printingId: '46986415' }]
    ]);
    assert.ok(cards.every(card => card.deck === 'list:1'));
    assert.deepEqual(notes, ['YGOPRODeck does not know the passcode 12345678.']);
});

const tcgdex: Record<string, unknown> = {
    '/en/sets?abbreviation.official=eq:OBF': [{ id: 'sv03' }],
    '/en/sets?abbreviation.official=eq:SVE': [{ id: 'sve' }],
    '/en/sets?abbreviation.official=eq:XYZ': [],
    '/en/sets/sv03': { cards: [
        { id: 'sv03-001', localId: '001', name: 'Oddish', image: 'https://assets.tcgdex.net/en/sv/sv03/001' },
        { id: 'sv03-125', localId: '125', name: 'Charizard ex', image: 'https://assets.tcgdex.net/en/sv/sv03/125' }
    ] },
    '/de/sets/sv03': { cards: [{ id: 'sv03-001', localId: '001', name: 'Myrapla', image: 'https://assets.tcgdex.net/de/sv/sv03/001' }, { id: 'sv03-125', localId: '125', name: 'Glurak-ex' }] },
    '/de/cards?name=eq:Glurak-ex': [],
    '/en/sets/sve': { cards: [{ id: 'sve-002', localId: '002', name: 'Fire Energy' }] },
    '/en/cards?name=eq:Fire%20Energy': [{ id: 'sve-002', localId: '002', name: 'Fire Energy' }, { id: 'xy12-92', localId: '92', name: 'Fire Energy', image: 'https://assets.tcgdex.net/en/xy/xy12/92' }]
};

function mockTcgdex() {
    const urls: string[] = [];
    mock.method(globalThis, 'fetch', async (url: string) => {
        const query = url.replace('https://api.tcgdex.net/v2', '');
        urls.push(query);
        return query in tcgdex ? Response.json(tcgdex[query]) : new Response('{}', { status: 404 });
    });
    return urls;
}

test('importDeckList finds the cards of a Pokémon list by set and number in the language of the order, and says where it fell back', async () => {
    const urls = mockTcgdex();
    const list = ['Pokémon: 2', '4 Oddish OBF 1', '2 Charizard ex OBF 125', 'Energy: 1', '8 Basic {R} Energy SVE 2', '1 Mystery Card XYZ 9'].join('\n');

    const { cards, notes } = await importDeckList({ url: 'list:2', data: [DeckData.MainBoard], list }, 'pokemon', 'de');

    assert.deepEqual(cards.map(card => [card.name, card.quantity, card.tcgCard, card.imported?.moxfieldId]), [
        ['Myrapla', 4, { tcg: 'pokemon', id: 'sv03-001', lang: 'de', image: 'https://assets.tcgdex.net/de/sv/sv03/001/high.png' }, 'OBF 1'],
        ['Charizard ex', 2, { tcg: 'pokemon', id: 'sv03-125', lang: 'en', image: 'https://assets.tcgdex.net/en/sv/sv03/125/high.png' }, 'OBF 125'],
        ['Fire Energy', 8, { tcg: 'pokemon', id: 'xy12-92', lang: 'en', image: 'https://assets.tcgdex.net/en/xy/xy12/92/high.png' }, 'SVE 2']
    ]);
    assert.deepEqual(notes, [
        'Charizard ex OBF 125 has no German image and prints in English.',
        'Fire Energy SVE 2 has no image and prints as xy12-92.',
        'TCGdex does not know Mystery Card XYZ 9.'
    ]);
    assert.equal(urls.filter(url => url.includes('eq:OBF')).length, 1, 'each set is looked up once');
});

test('parseLorcanaList reads the lines of Dreamborn and Inkdecks exports and adds up repeated cards', () => {
    const { entries, unknown } = parseLorcanaList('4 Elsa - Snow Queen\n2x Be Our Guest\n\n1 elsa - Snow Queen\nnot a card');

    assert.deepEqual(entries, [{ quantity: 5, name: 'Elsa - Snow Queen' }, { quantity: 2, name: 'Be Our Guest' }]);
    assert.deepEqual(unknown, ['not a card']);
});

test('parseOnePieceList reads the ids of OPTCGSim and Limitless exports, also of starter decks and promos, without the names after them', () => {
    const { entries, unknown } = parseOnePieceList('1xOP01-001\n4x op01-016 Nami\n4 ST01-012\n2xP-001\nLeader');

    assert.deepEqual(entries.map(entry => [entry.quantity, entry.name]), [[1, 'OP01-001'], [4, 'OP01-016'], [4, 'ST01-012'], [2, 'P-001']]);
    assert.deepEqual(unknown, ['Leader']);
});

const deck: DeckConfig = { url: 'list:1', data: [DeckData.MainBoard] };

const lorcast = (id: string, name: string, version: string | null, set: string) =>
    ({ id, name, version, collector_number: '1', set: { code: set, name: set }, image_uris: { digital: { large: `https://cards.lorcast.io/card/digital/large/${id}.avif` } } });

test('importDeckList takes the first printing Lorcast has of each Lorcana card and names the cards it does not know', async t => {
    const asked: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string) => {
        const query = new URL(url).searchParams.get('q')!;
        asked.push(query);
        return query.includes('Snow Queen')
            ? Response.json({ results: [lorcast('crd_1', 'Elsa', 'Snow Queen', '1'), lorcast('crd_2', 'Elsa', 'Snow Queen', '9'), lorcast('crd_3', 'Elsa', 'Snow Queen Again', '9')] })
            : Response.json({ results: [] });
    });

    const { cards, notes } = await importDeckList({ ...deck, list: '4 Elsa - Snow Queen\n2 Unknown Card' }, 'lorcana', 'en');

    assert.deepEqual(asked, ['name:"Elsa" version:"Snow Queen"', 'name:"Unknown Card"']);
    assert.deepEqual(cards.map(card => [card.name, card.quantity, card.tcgCard]), [['Elsa - Snow Queen', 4, { tcg: 'lorcana', id: 'crd_1', image: 'https://cards.lorcast.io/card/digital/large/crd_1.avif' }]]);
    assert.deepEqual(notes, ['Lorcast does not know Unknown Card.']);
    assert.deepEqual((await searchTcgCards('lorcana', 'Elsa - Snow Queen', 'en')).map(card => card.id), ['crd_1', 'crd_2']);
});

test('importDeckList takes the regular artwork of each One Piece card from optcgapi.com, where starter decks and promos have paths of their own', async t => {
    const asked: string[] = [];
    const card = (id: string, name: string) => ({ card_name: name, card_set_id: id.replace(/_.*/, ''), card_image_id: id, card_image: `https://optcgapi.com/media/static/Card_Images/${id}.jpg` });
    t.mock.method(globalThis, 'fetch', async (url: string) => {
        asked.push(url);
        if (url.endsWith('/sets/card/OP01-001/')) return Response.json([card('OP01-001_p1', 'Roronoa Zoro (001) (Parallel)'), card('OP01-001', 'Roronoa Zoro (001)')]);
        if (url.endsWith('/decks/card/ST01-001/')) return Response.json([card('ST01-001', 'Monkey.D.Luffy (001)')]);
        return new Response('[]', { status: 404 });
    });

    const { cards, notes } = await importDeckList({ ...deck, list: '1xOP01-001\n4xST01-001\n2xP-999' }, 'onepiece', 'en');

    assert.deepEqual(asked.map(url => url.replace('https://optcgapi.com/api', '')), ['/sets/card/OP01-001/', '/decks/card/ST01-001/', '/promos/card/P-999/']);
    assert.deepEqual(cards.map(c => [c.name, c.quantity, c.tcgCard?.id]), [['Roronoa Zoro', 1, 'OP01-001'], ['Monkey.D.Luffy', 4, 'ST01-001']]);
    assert.deepEqual(notes, ['optcgapi.com does not know P-999.']);
});
