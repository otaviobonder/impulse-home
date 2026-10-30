#!/usr/bin/env node
/*
 * Opening CarPlay asks the CarPlay service for the screen.
 * Raising the old task alone never does, so the service finishes the activity
 * 1.5 s later and the tap bounces back to the launcher.
 *
 * Run: node scripts/test-carplay-launch.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = (name) => readFileSync(
  resolve(root, 'app/src/main/java/com/havalh6/viewer', name), 'utf8',
).replace(/\r\n/g, '\n');
const activity = source('MainActivity.java');
const presence = source('ProjectionPresence.java');

function blockFrom(text, token) {
  const start = text.indexOf(token);
  assert.ok(start >= 0, `missing ${token}`);
  const brace = text.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unterminated ${token}`);
}

const launch = blockFrom(activity, 'private void launchProjection(ProjectionPresence.Kind kind)');
const askAt = launch.indexOf('projectionPresence.requestCarPlayUi()');
const raiseAt = launch.indexOf('moveTaskToFrontNoAnim(');
assert.ok(askAt >= 0, 'launchProjection must ask the service for the CarPlay screen');
assert.ok(raiseAt >= 0, 'launchProjection must keep the raise path for Android Auto and for an unsent request');
assert.ok(askAt < raiseAt, 'the CarPlay request must come before any task raise');

const carPlayBranch = blockFrom(launch, 'if (kind == ProjectionPresence.Kind.CARPLAY');
assert.match(carPlayBranch, /if \(kind == ProjectionPresence\.Kind\.CARPLAY\s*&& projectionPresence\.requestCarPlayUi\(\)\)/,
  'only CarPlay sends the request, and a request that was not sent falls through to the raise');
assert.match(carPlayBranch, /clearPendingProjection\(\);/,
  'a resolve still pending from an earlier tap must not raise the old task afterwards');
assert.match(carPlayBranch, /return;/, 'a sent request must skip the raise');

const request = blockFrom(presence, 'boolean requestCarPlayUi()');
assert.match(request, /if \(!cpLinked\) return false;/,
  'with no phone linked there is nothing to show, so the request must not be sent');
assert.doesNotMatch(request, /readInt\(/,
  'this runs on the main thread, so it must not wait on a link-status call');
assert.match(request, /writeInterfaceToken\(CP_DESCRIPTOR\);\s*data\.writeInt\(CP_UI_MODE_NORMAL\);/,
  'requestUi takes a single int after the interface token');
assert.match(request, /transact\(CP_TX_REQUEST_UI, data, null, IBinder\.FLAG_ONEWAY\)/,
  'the request must be one-way so the tap never waits on the service');
assert.match(presence, /CP_TX_REQUEST_UI = 20;/, 'requestUi is ICarPlayService transaction 20');
assert.match(presence, /CP_UI_MODE_NORMAL = 0;/, 'mode 0 is the normal centre-screen request');

const linked = blockFrom(presence, 'private boolean carPlayLinked()');
assert.match(linked, /cpLinked = /, 'the poll must keep the link state current for the tap');
assert.match(blockFrom(presence, 'void stop()'), /cpLinked = false;/,
  'stopping drops the binder, so the link state must go with it');

console.log('carplay launch contract: ok');
