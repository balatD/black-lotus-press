import { test } from "node:test";
import assert from "node:assert/strict";
import { deckSides, projectName } from "./printerstudio.js";

test('projectName is the order and the date in the 32 characters printerstudio.de takes, with the deck when there are several', () => {
    const day = new Date(2026, 9, 19);

    assert.equal(projectName('sauron', 0, 1, day), 'sauron 2026-10-19');
    assert.equal(projectName('sauron', 1, 2, day), 'sauron 2/2 2026-10-19');
    assert.equal(projectName('the very long commander deck name', 0, 3, day), 'the very long... 1/3 2026-10-19');
    assert.ok(projectName('x'.repeat(60), 11, 12, day).length <= 32);
});

test('deckSides gives every card the one card back when no card has a back of its own', () => {
    const pack = [{ front: 'island.jpg', back: 'cardback.jpg' }, { front: 'forest.jpg', back: 'cardback.jpg' }];

    assert.deepEqual(deckSides(pack, 'cardback.jpg'), [
        { files: ['island.jpg', 'forest.jpg'], same: false },
        { files: ['cardback.jpg'], same: true }
    ]);
});

test('deckSides lists the back of every card when one of them is double-faced', () => {
    const pack = [{ front: 'island.jpg', back: 'cardback.jpg' }, { front: 'dfc-front.jpg', back: 'dfc-back.jpg' }];

    assert.deepEqual(deckSides(pack, 'cardback.jpg')[1], { files: ['cardback.jpg', 'dfc-back.jpg'], same: false });
});
