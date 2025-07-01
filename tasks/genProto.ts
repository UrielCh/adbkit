import { EOL } from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Gent Typescript interface from protobuf.
 */

function convert(data: string) {
  data = data.replace(/ \[default = \d+\]/g, '');
  data = data.replace(/message (\w+) /g, 'export interface $1 ');
  data = data.replace(/enum (\w+) /g, 'export const $1Map = {'); // broken...
  data = data.replace(/ bytes /g, ' Uint8Array ');
  data = data.replace(/ bool /g, ' boolean ');
  data = data.replace(/\s(uint32|bytes|double|int32|float)\s/g, ' number ');
  data = data.replace(/ {2}=/g, ' =');
  data = data.replace(/optional (\w+) (\w+) = \d+;/g, '$2?: $1;');
  data = data.replace(/required (\w+) (\w+) = \d+;/g, '$2: $1;');
  data = data.replace(/repeated (\w+) (\w+) = \d+;/g, '$2: $1[];');
  // enum
  data = data.replace(/\s{2,}([a-zA-Z_]+)\s+=\s+(\d+);/g, `${EOL}  $1 = $2,`);

  data = data.replace(/syntax = "proto2";[\r\n]+/g, '');
  data = data.replace(/package jp.co.cyberagent.stf.proto;[\r\n]+/g, '');
  data = data.replace(/option java_outer_classname = "Wire";[\r\n]+/g, '');
  data = data.replace(/export interface (\w+) \{([\r\n]+)\}/gm, '// eslint-disable-next-line @typescript-eslint/no-empty-interface$2export interface $1 {}');
  //data = data.replace(/export interface (\w+)/g, '// cCCCCeslint-disable-next-line @typescript-eslint/no-empty-interface$2export interface $1 {}');
  //  repeated string properties = 1;
  // optional uint32 id = 1;
  return data;
}


function genSet(source: string, prefix: string) {
  const fn = path.resolve(__dirname, '..', 'bin', source);
  const dest = path.resolve(__dirname, '..', 'src', 'adb', 'thirdparty', 'STFService', prefix + 'Model.ts');
  const dest2 = path.resolve(__dirname, '..', 'src', 'adb', 'thirdparty', 'STFService', prefix + 'Buf.ts');
  let data = fs.readFileSync(fn, { encoding: 'utf8' });
  data = convert(data);
  fs.writeFileSync(dest, `// generarted by genProto.ts${EOL}` + data, { encoding: 'utf8' });


  let helper = `// generarted by genProto.ts${EOL}`
  helper += `import { Message, Root, load } from 'protobufjs';
import ThirdUtils from '../ThirdUtils';
import * as STF from './${prefix}Model';

let singleton: Promise<${prefix}Buf> | null = null;
type MyMessage<T extends object = object> = Message<T> & T;
let root: Root;

export default class ${prefix}Buf {
  private static async internalInit(): Promise<${prefix}Buf> {
    const proto = ThirdUtils.getResource('${source}');
    const _root = await load(proto);
    root = _root;
    return new ${prefix}Buf(_root);
  }

  public static get(): Promise<${prefix}Buf> {
    if (!singleton) singleton = this.internalInit();
    return singleton;
  }

  private constructor(private _root: Root) {
  }

  get root(): Root {
    return this._root;
  }
  
  readEnvelope(data: Uint8Array): MyMessage<STF.Envelope> {
    const type = root.lookupType('Envelope');
    return type.decode(data) as MyMessage<STF.Envelope>;
  }
  
  readEnvelopeDelimited(data: Uint8Array): MyMessage<STF.Envelope> {
    const type = root.lookupType('Envelope');
    return type.decodeDelimited(data) as MyMessage<STF.Envelope>;
  }

`

  const allReq = [...data.matchAll(/interface ([a-zA-Z]+(Request|Message)) /g)].map(m => m[1]);
  // if (!allReq.length)
  //   allReq = [...data.matchAll(/interface ([a-zA-Z]+) /g)].map(m => m[1]).filter(m => m !== 'Envelope');

  let writers = `  public write = {
    Envelope(env: STF.Envelope): Buffer {
      const type = root.lookupType('Envelope');
      return Buffer.from(type.encodeDelimited(env).finish());
    },${EOL}`
  for (const name of allReq) {
    writers += `    ${name}(req: STF.${name}): Buffer {
      const type = root.lookupType('${name}');
      return Buffer.from(type.encode(req).finish());
    },${EOL}`;
  }
  writers += `  }${EOL}`;

  // const allResp = [...data.matchAll(/interface ([a-zA-Z]+Response) /g)].map(m => m[1]);
  const allResp = [...data.matchAll(/interface ([a-zA-Z]+) /g)]
    .map(m => m[1])
    .filter(n => !n.includes('Request'));
  
  // console.log(allResp);
  let readers = `  public read = {${EOL}`;
  for (const name of allResp) {
    readers += `    ${name}(data: Uint8Array): MyMessage<STF.${name}> {
      const type = root.lookupType('${name}');
      return type.decode(data) as MyMessage<STF.${name}>;
    },${EOL}`;
  }
  readers += `  }${EOL}`

  helper += writers;
  helper += EOL
  helper += readers
  helper += `}${EOL}`;

  fs.writeFileSync(dest2, helper, { encoding: 'utf8' });
}

function main() {
  genSet('wireService.proto', 'STFService')
  // genSet('wireAgent.proto', 'STFAgent')
}

void main();