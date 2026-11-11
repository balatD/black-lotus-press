// The band under the hero: random Magic and Pokémon cards from Scryfall and TCGdex on every visit, and Yu-Gi-Oh cards stored on this
// site, as YGOPRODeck asks for its images not to be loaded from its server. It drifts by without end until it is hovered or paused.
const band = document.querySelector('.card-band');
const track = band.querySelector('.card-track');
const pause = band.querySelector('.band-pause');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const PER_GAME = 8;
// A slow or unreachable API leaves its cards out rather than holding the band back.
const WAIT_MS = 3000;
const SPEED_PX_PER_S = 35;
// Scryfall allows two searches a second, so one page of 175 cards, from a random point in one of these orders, is all it is asked for.
const MAGIC_QUERY = 'game:paper -t:token is:hires';
const MAGIC_PAGES = 180;
const MAGIC_ORDERS = ['artist', 'released', 'set'];

const YUGIOH = [
    [27503418, "King's Synchro"], [91949988, 'Gaia Dragon, the Thunder Charger'], [15458892, 'Starship Spy Plane'], [35322812, 'Woodborg Inpachi'],
    [56585883, 'Harpie Harpist'], [81927732, 'Raidraptor - Revolution Falcon'], [9197735, 'Dragon Statue'], [31034919, 'Mad Reloader'],
    [24429467, 'Mythical Bestiamorph'], [50546029, 'G Golem Dignified Trilithon'], [99523325, "Gravekeeper's Stele"], [50621530, 'Powered Tuner'],
    [17621695, 'Enneapolis'], [6500778, 'Chaos Distill'], [41930553, 'Dark Smog'], [85602018, 'Last Will']
];

function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

const random = list => list[Math.floor(Math.random() * list.length)];

async function magic() {
    const page = 1 + Math.floor(Math.random() * MAGIC_PAGES);
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(MAGIC_QUERY)}&order=${random(MAGIC_ORDERS)}&page=${page}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const { data } = await response.json();
    return shuffle(data).slice(0, PER_GAME).flatMap(card => {
        const image = card.image_uris ?? card.card_faces?.[0]?.image_uris;
        return image ? [{ src: image.normal, name: card.name, width: 488, height: 680 }] : [];
    });
}

async function pokemon() {
    const cards = await Promise.all(Array.from({ length: PER_GAME }, () =>
        fetch('https://api.tcgdex.net/v2/en/random/card').then(response => response.ok ? response.json() : undefined, () => undefined)));
    return cards.flatMap(card => card?.image ? [{ src: `${card.image}/high.webp`, name: card.name, width: 600, height: 825 }] : []);
}

function yugioh() {
    return shuffle([...YUGIOH]).slice(0, PER_GAME).map(([id, name]) => ({ src: `img/cards/ygo/${id}.webp`, name, width: 400, height: 583 }));
}

function settle(cards) {
    return Promise.race([cards.catch(() => []), new Promise(resolve => setTimeout(() => resolve([]), WAIT_MS))]);
}

// The card keeps its shape when its image fails, so the band does not jump.
function tile(card) {
    const item = document.createElement('li');
    item.title = card.name;
    item.style.aspectRatio = `${card.width} / ${card.height}`;
    const image = new Image(card.width, card.height);
    image.alt = '';
    image.decoding = 'async';
    image.src = card.src;
    image.addEventListener('error', () => image.remove());
    item.append(image);
    return item;
}

async function start() {
    const [magicCards, pokemonCards] = await Promise.all([settle(magic()), settle(pokemon())]);
    const cards = shuffle([...yugioh(), ...magicCards, ...pokemonCards]);
    track.append(...cards.map(tile));
    band.hidden = false;
    if (reduced) {
        pause.hidden = true;
        return;
    }

    // One run of cards covers the widest screen, and a second run follows it, so moving by one run starts the loop over unseen.
    const wide = Math.max(screen.width, innerWidth);
    let runs = 1;
    for (; track.scrollWidth < wide; runs++) track.append(...cards.map(tile));
    const width = track.scrollWidth;
    for (let i = 0; i < runs; i++) track.append(...cards.map(tile));
    track.style.setProperty('--band-duration', `${width / SPEED_PX_PER_S}s`);
    track.classList.add('moving');

    pause.addEventListener('click', () => {
        const paused = band.classList.toggle('paused');
        pause.setAttribute('aria-pressed', String(paused));
        pause.textContent = paused ? 'Play' : 'Pause';
    });
}

void start();
