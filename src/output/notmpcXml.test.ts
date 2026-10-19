import { test } from "node:test";
import assert from "node:assert/strict";
import { notmpcXml } from "./notmpcXml.js";

const urls = new Map([
    ['island.jpg', 'https://notmpc.eu/tmp/img_island.jpg'],
    ['dfc-front.jpg', 'https://notmpc.eu/tmp/img_dfc_front.jpg'],
    ['dfc-back.jpg', 'https://notmpc.eu/tmp/img_dfc_back.jpg'],
    ['cardback.jpg', 'https://notmpc.eu/tmp/img_back.jpg?a=1&b=2']
]);

test('notmpcXml lists each front once with its slots and only the backs that are not the card back', () => {
    const pack = [
        { front: 'island.jpg', back: 'cardback.jpg' },
        { front: 'dfc-front.jpg', back: 'dfc-back.jpg' },
        { front: 'island.jpg', back: 'cardback.jpg' }
    ];

    assert.equal(notmpcXml(pack, urls, 'cardback.jpg'), `<?xml version="1.0" encoding="UTF-8"?>
<order>
  <fronts>
    <card><id>https://notmpc.eu/tmp/img_island.jpg</id><slots>0,2</slots></card>
    <card><id>https://notmpc.eu/tmp/img_dfc_front.jpg</id><slots>1</slots></card>
  </fronts>
  <backs>
    <card><id>https://notmpc.eu/tmp/img_dfc_back.jpg</id><slots>1</slots></card>
  </backs>
  <cardback>https://notmpc.eu/tmp/img_back.jpg?a=1&amp;b=2</cardback>
</order>
`);
});

test('notmpcXml fails when an image has no uploaded URL', () => {
    assert.throws(() => notmpcXml([{ front: 'unknown.jpg', back: 'cardback.jpg' }], urls, 'cardback.jpg'), /unknown\.jpg/);
});
