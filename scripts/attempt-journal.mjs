import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {plainPath} from './integrity.mjs';
import {readBounded} from './material-pack.mjs';

export function journalPath(context,id) {
  if(typeof id!=='string'||!/^attempt-[A-Za-z0-9_-]+$/.test(id))throw new Error('Invalid attempt identity.');
  return path.join(context.directory,'attempts',id+'.json');
}
export function saveJournal(file,record) {
  plainPath(file,path.parse(path.resolve(file)).root);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).nlink>1))throw new Error('Unsafe journal file.');
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  const fd=fs.openSync(temporary,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(record,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);
}
export function createJournal(context,details) {
  const file=journalPath(context,details.attempt_id);
  if(fs.existsSync(file))throw new Error('Attempt journal already exists.');
  let record={version:1,...details,stage:'prepared',worker_dispatched:false,retry_claim_path:null,history:[]};
  const checkpoint=(stage,extra={})=>{
    record={...record,...extra,stage,updated_at:new Date().toISOString()};
    record.history=[...record.history,{stage,at:record.updated_at}].slice(-20);saveJournal(file,record);
  };
  checkpoint('prepared');
  return {file,checkpoint};
}
export function readJournal(file){return JSON.parse(readBounded(file,64*1024));}
