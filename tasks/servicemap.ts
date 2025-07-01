/* eslint-disable @typescript-eslint/no-unused-vars */
import https from 'node:https';
import GitSource from './GitSource'

// import strip from 'strip-comments';
// import { parse, BaseJavaCstVisitor, LambdaExpressionCtx, BaseJavaCstVisitorWithDefaults } from "java-parser";

// list file from repo
// https://api.github.com/repos/${l_githubUser}/${l_githubProject}/git/trees/${l_branch}?recursive=1
// https://api.github.com/repos/aosp-mirror/platform_frameworks_base
// android-11.0.0_r35
// https://api.github.com/repos/octocat/Hello-World/branches

// list branches
// https://api.github.com/repos/aosp-mirror/platform_frameworks_base/branches
// list file from branches
// 

function getData(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const data: Buffer[] = [];
      // const headerDate = res.headers && res.headers.date ? res.headers.date : 'no response date';
      // console.log('Status Code:', res.statusCode);
      // console.log('Date in Response header:', headerDate);
      if (res.statusCode !== 200) {
        reject(Error('Status Code:' + res.statusCode));
        return;
      }

      res.on('data', chunk => {
        data.push(chunk);
      });

      res.on('end', () => {
        // console.log('Response ended: ');
        resolve(Buffer.concat(data));
      });
    }).on('error', err => {
      console.log('Error: ', err.message);
      reject(err);
    });
  })
}
// https://android.googlesource.com/platform/frameworks/base/+/android-11.0.0_r35/core/java/android/security/keymaster/IKeyAttestationApplicationIdProvider.aidl?format=TEXT
// https://android.googlesource.com/platform/frameworks/base/+/android-11.0.0_r35/telephony/java/android/hardware/fingerprint/IFingerprintService.aidl?format=TEXT

async function getAllTags2(): Promise<string[]> {
  const data = await getData('git ls-remote --tags --sort="v:refname" https://android.googlesource.com/platform/frameworks/base.git');
  // git ls-remote --tags --sort="v:refname" https://android.googlesource.com/platform/frameworks/base.git | cut -d'/' -f3 | cut -d'^' -f1 
  const asText = data.toString('ascii');
  const TAGS = /refs\/tags\/(android-[0-9_r.]+)\^\{\}/gm;
  const tags: string[] = [];
  for (; ;) {
    const match = TAGS.exec(asText);
    if (!match)
      break;
    tags.push(match[1]);
  }
  return tags;
}

/**
 * getAllTags from google source git
 * @returns 
 */
async function getAllTags(): Promise<string[]> {
  const data = await getData('https://android.googlesource.com/platform/frameworks/base/+refs/tags/?format=text');
  // git ls-remote --tags --sort="v:refname" https://android.googlesource.com/platform/frameworks/base.git | cut -d'/' -f3 | cut -d'^' -f1 
  const asText = data.toString('ascii');
  const TAGS = /refs\/tags\/(android-[0-9_r.]+)\^\{\}/gm;
  const tags: string[] = [];
  for (; ;) {
    const match = TAGS.exec(asText);
    if (!match)
      break;
    tags.push(match[1]);
  }
  return tags;
}


async function getAidl(tag: string, pkgName: string) {
  const pkg = pkgName.replace(/\./g, '/');
  let data: Buffer | null = null;
  try {
    const url = `https://android.googlesource.com/platform/frameworks/base/+/${tag}/core/java/${pkg}.aidl?format=TEXT`;
    // console.log(url);
    data = await getData(url);
  } catch (e) {
    // console.log(e);
    return;
  }
  //console.log(data);
  const asBase64 = data.toString('ascii');
  const javaCode = Buffer.from(asBase64, 'base64').toString('ascii');
  console.log(javaCode);


  // const cst = parse(javaCode)
  //const lambdaArrowsCollector = new LambdaArrowsPositionCollector();
  // The CST result from the previous code snippet
  //lambdaArrowsCollector.visit(cst);
  return;
  //const striped = strip(code).replace(/^\s+$/gm, '');
  //console.log(`${pkgName} tag: ${tag} exists, len:${striped.length}`);
  //console.log(striped);
  //console.log('resp', );
}

async function main() {
  const src = new GitSource('android-src', 'https://android.googlesource.com/platform/frameworks/base.git');
  const tags = await src.listTag();

  for (const tag of tags) {
    console.log('tag:', tag);
    await src.checkoutTag(tag);
    break;
  }
  // const tags = await getAllTags();
  // for (const tag of tags) {
  //     await getAidl(tag, 'android.hardware.display.IDisplayManager')
  //     // await getAidl(tag, 'android.security.keymaster.IKeyAttestationApplicationIdProvider')
  //     // 
  // }
}

main();