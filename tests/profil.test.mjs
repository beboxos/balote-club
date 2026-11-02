import assert from 'node:assert/strict';
import { pseudoValide, avatarValide, avatarSrc } from '../js/core/profil.js';

for (const ok of ['Stéphane', 'Léa_92', 'Jo.Bi-3', 'abc', 'quatorze chars!'.slice(0, 14).replace('!', 'x')]) assert.ok(pseudoValide(ok), ok);
for (const ko of ['ab', '', ' a ', 'x'.repeat(15), 'a<b>c', 'Hitler', 'f.u.c.k'.replace(/\./g, ''), 'Éric😀']) assert.ok(!pseudoValide(ko), ko);

assert.ok(avatarValide('01') && avatarValide('06'));
assert.ok(!avatarValide('07') && !avatarValide(null) && !avatarValide(12));
const photo = 'data:image/webp;base64,' + 'A'.repeat(500);
assert.ok(avatarValide(photo));
assert.ok(!avatarValide('data:image/svg+xml;base64,AAAA'));
assert.ok(!avatarValide('data:image/webp;base64,' + 'A'.repeat(20001)));
assert.ok(!avatarValide('data:image/webp;base64,AAA"onerror="x'));
assert.equal(avatarSrc('03'), 'assets/avatars/03.webp');
assert.equal(avatarSrc(photo), photo);
assert.equal(avatarSrc('javascript:alert(1)'), 'assets/avatars/01.webp');
console.log('profil OK');
