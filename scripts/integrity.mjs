import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const digest = data => crypto.createHash('sha256').update(data).digest('hex');
export function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
}
export function plainPath(target, root) {
  const resolved = path.resolve(target);
  if (!inside(resolved, root)) throw new Error('Path escapes workspace: ' + target);
  let cursor = resolved;
  while (inside(cursor, root)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink())
      throw new Error('Link or junction is not supported: ' + cursor);
    if (cursor === root) break;
    cursor = path.dirname(cursor);
  }
  return resolved;
}
export function fileDigest(target, root) {
  plainPath(target, root);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.nlink > 1) throw new Error('Unsupported file type or hard link: ' + target);
  return digest(fs.readFileSync(target));
}
export function evidenceSnapshot(base, current, root) {
  const files = {};
  let bytes = 0;
  let count = 0;
  const walk = dir => {
    plainPath(dir, root);
    for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
      const full = path.join(dir, entry.name);
      if (inside(full, current)) continue;
      plainPath(full, root);
      if (entry.isDirectory()) walk(full);
      else {
        bytes += fs.lstatSync(full).size;
        if (++count > 10000 || bytes > 256 * 1024 * 1024)
          throw new Error('Historical evidence exceeds inspection limit');
        files[path.relative(base, full)] = fileDigest(full, root);
      }
    }
  };
  walk(base);
  return files;
}
export function checkArtifacts(manifest, required, attempt, workspace) {
  const errors = [];
  const hashes = {};
  for (const value of manifest?.artifacts || []) {
    const full = path.isAbsolute(value) ? path.resolve(value) : path.resolve(attempt, value);
    try {
      if (!inside(full, attempt)) throw new Error('Artifact must be in current attempt');
      hashes[full] = fileDigest(full, workspace);
    } catch (err) { errors.push(value + ': ' + err.message); }
  }
  for (const value of required || []) {
    const full = path.resolve(attempt, value);
    if (!(full in hashes)) errors.push('Required artifact missing from verified manifest: ' + value);
  }
  return {passed: errors.length === 0, errors, hashes};
}
