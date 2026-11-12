import Bottleneck from "bottleneck";

// Lorcast asks for 50 to 100 ms between requests.
const lorcastBottleneck = new Bottleneck({
    maxConcurrent: 1,
    minTime: 100
});

const API = 'https://api.lorcast.com/v0';
const headers = { "Accept": "application/json", "User-Agent": "BlackLotusPress/1.0" };

export interface LorcastCard {
    id: string;
    name: string;
    version: string | null;
    collector_number: string;
    set: { code: string, name: string };
    image_uris?: { digital?: { small?: string, normal?: string, large?: string } };
}

// "Elsa - Snow Queen" is the card Elsa in the version Snow Queen; actions and items have no version.
export function lorcanaName(card: Pick<LorcastCard, 'name' | 'version'>) {
    return card.version ? `${card.name} - ${card.version}` : card.name;
}

// Every printing of the card of that full name, in the order of the sets, without those Lorcast has no image of.
export async function searchLorcanaPrintings(fullName: string): Promise<LorcastCard[]> {
    const [name, ...version] = fullName.split(' - ');
    const query = `name:"${name}"` + (version.length > 0 ? ` version:"${version.join(' - ')}"` : '');
    const response = await lorcastBottleneck.schedule(() => fetch(`${API}/cards/search?q=${encodeURIComponent(query)}&unique=prints`, { headers }));
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`Looking up ${fullName} on Lorcast failed (${response.status}): ${await response.text()}`);
    const { results } = await response.json() as { results: LorcastCard[] };
    return results.filter(card => lorcanaName(card).toLowerCase() === fullName.toLowerCase() && card.image_uris?.digital?.large);
}
