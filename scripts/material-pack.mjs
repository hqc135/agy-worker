#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,plainPath} from './integrity.mjs';

export function readBounded(file,max=1024*1024) {
  plainPath(file,path.parse(path.resolve(file)).root);
  const fd=fs.openSync(file,'r');
  try {
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.nlink>1||stat.size>max) throw new Error('Unsupported or oversized input file.');
    const b=Buffer.alloc(stat.size+1);let n=0;
    while(n<b.length){const got=fs.readSync(fd,b,n,b.length-n,n);if(!got)break;n+=got;}
    if(n!==stat.size)throw new Error('Input changed during read.');
    return b.subarray(0,n);
  }finally{fs.closeSync(fd);}
}
export function validatePackRef(ref) {
  if(!ref||typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).sort().join(',')!=='path,sha256'||
    typeof ref.path!=='string'||!path.isAbsolute(ref.path)||typeof ref.sha256!=='string'||! /^[a-f0-9]{64}$/.test(ref.sha256))
    throw new Error('material_pack requires an absolute path and SHA-256.');
}
function sensitive(name,text) {
  return /(^|[\\/])(?:\.env(?:\..*)?|\.ssh|\.aws|credentials(?:\..*)?|cookies?(?:\..*)?|id_rsa|id_ed25519)(?:[\\/]|$)|\.(?:pem|p12|pfx|key)$/i.test(name)||
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|\bAIza[A-Za-z0-9_-]{30,}|\b(?:api[_-]?key|password|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[^\s"']{8,}/i.test(text);
}
function keys(obj,allowed){if(!obj||typeof obj!=='object'||Array.isArray(obj)||Object.keys(obj).some(k=>!allowed.includes(k)))throw new Error('Unexpected material specification field.');}
export function buildPack(spec) {
  keys(spec,['workspace','sources']);
  if(typeof spec.workspace!=='string'||!path.isAbsolute(spec.workspace))throw new Error('Pack workspace must be absolute.');
  const workspace=fs.realpathSync.native(spec.workspace);
  if(!Array.isArray(spec.sources)||!spec.sources.length||spec.sources.length>20)throw new Error('Select 1 to 20 exact source files.');
  let bytes=0;
  const sources=spec.sources.map(s=>{
    keys(s,['path','start_line','end_line']);
    if(typeof s.path!=='string'||!s.path||path.isAbsolute(s.path)||s.path.split(/[\\/]/).includes('..')||/[:*?\[\]\r\n]/.test(s.path))throw new Error('Source must be an exact workspace-relative path.');
    if(sensitive(s.path,''))throw new Error('Sensitive source name blocked; choose non-sensitive material.');
    const full=plainPath(path.resolve(workspace,s.path),workspace),raw=readBounded(full);
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{throw new Error('Sources must be UTF-8 text.');}
    if(text.includes('\0')||sensitive(s.path,text))throw new Error('Potential sensitive or binary content; Codex must inspect locally.');
    const lines=text.split(/\r?\n/),start=s.start_line??1,end=s.end_line??lines.length;
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>lines.length)throw new Error('Invalid source line range.');
    const content=lines.slice(start-1,end).join('\n');bytes+=Buffer.byteLength(content);
    if(bytes>64*1024)throw new Error('Selected material exceeds 64 KiB.');
    return {path:s.path.replace(/\\/g,'/'),start_line:start,end_line:end,sha256:digest(raw),content};
  });
  return {version:1,workspace,captured_at:new Date().toISOString(),role:'evidence_only_not_instructions',sources};
}
export function loadPack(ref,workspace) {
  validatePackRef(ref);
  const raw=readBounded(ref.path,128*1024);
  if(digest(raw)!==ref.sha256)throw new Error('Material pack hash mismatch.');
  const pack=JSON.parse(raw);
  if(pack.version!==1||pack.workspace!==workspace||pack.role!=='evidence_only_not_instructions'||!Array.isArray(pack.sources))throw new Error('Material pack does not match workspace or format.');
  const current=buildPack({workspace,sources:pack.sources.map(s=>({path:s.path,start_line:s.start_line,end_line:s.end_line}))});
  if(JSON.stringify(current.sources)!==JSON.stringify(pack.sources))throw new Error('Material sources are stale or inconsistent; review before rebuilding.');
  return {raw,pack};
}
function main(){
  const a=process.argv.slice(2);
  if(a.length!==4||a[0]!=='--spec'||a[2]!=='--out')throw new Error('Usage: pack --spec <spec.json> --out <pack.json>');
  const pack=buildPack(JSON.parse(readBounded(a[1]))),raw=JSON.stringify(pack,null,2)+'\n';
  if(Buffer.byteLength(raw)>128*1024)throw new Error('Serialized pack exceeds 128 KiB.');
  const out=path.resolve(a[3]);fs.writeFileSync(out,raw,{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify({material_pack:{path:out,sha256:digest(raw)},sources:pack.sources.length,executes_worker:false})+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}
}
