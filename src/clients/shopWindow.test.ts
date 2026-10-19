import { test } from "node:test";
import assert from "node:assert/strict";
import type { Handover } from "../model.js";
import { stepProgress } from "./shopWindow.js";

const handover = (states: Handover['steps'][number]['state'][]): Handover => ({
    order: 'sauron',
    title: 'sauron to meinspiel.de',
    steps: states.map((state, index) => ({ label: ['Log in', 'Pack 1 of 2', 'Pack 2 of 2', 'Open the games'][index]!, state, detail: `detail ${index}` })),
    next: 'Choose the box'
});

test('stepProgress counts the finished steps and names the one at work, so the bar never sits at 0 while the PDFs go up', () => {
    assert.deepEqual(stepProgress(handover(['active', 'pending', 'pending', 'pending'])), { done: 0, total: 4, message: 'Log in: detail 0' });
    assert.deepEqual(stepProgress(handover(['done', 'warning', 'active', 'pending'])), { done: 2, total: 4, message: 'Pack 2 of 2: detail 2' });
    assert.deepEqual(stepProgress(handover(['done', 'failed', 'pending', 'pending'])), { done: 1, total: 4, message: 'Pack 1 of 2: detail 1' });
    assert.deepEqual(stepProgress(handover(['done', 'done', 'done', 'done'])), { done: 4, total: 4, message: 'Choose the box' });
});
