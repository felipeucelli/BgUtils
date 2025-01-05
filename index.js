class BotGuardClient {
  constructor(options) {
      this.vmFunctions = {};
      this.userInteractionElement = options.userInteractionElement;
      this.vm = options.globalObj[options.globalName];
      this.program = options.program;
  }

  static async create(options) {
      return await new BotGuardClient(options).load();
  }
  async load() {
      if (!this.vm)
          throw new Error('[BotGuardClient]: VM not found in the global object');
      if (!this.vm.a)
          throw new Error('[BotGuardClient]: Could not load program');
      const vmFunctionsCallback = (asyncSnapshotFunction, shutdownFunction, passEventFunction, checkCameraFunction) => {
          Object.assign(this.vmFunctions, { asyncSnapshotFunction, shutdownFunction, passEventFunction, checkCameraFunction });
      };
      try {
          this.syncSnapshotFunction = await this.vm.a(this.program, vmFunctionsCallback, true, this.userInteractionElement, () => { }, [[], []])[0];
      }
      catch (error) {
          throw new Error(`[BotGuardClient]: Failed to load program (${error.message})`);
      }
      return this;
  }
  /**
   * Takes a snapshot asynchronously.
   * @returns The snapshot result.
   * @example
   * ```ts
   * const result = await botguard.snapshot({
   *   contentBinding: {
   *     c: "a=6&a2=10&b=SZWDwKVIuixOp7Y4euGTgwckbJA&c=1729143849&d=1&t=7200&c1a=1&c6a=1&c6b=1&hh=HrMb5mRWTyxGJphDr0nW2Oxonh0_wl2BDqWuLHyeKLo",
   *     e: "ENGAGEMENT_TYPE_VIDEO_LIKE",
   *     encryptedVideoId: "P-vC09ZJcnM"
   *    }
   * });
   *
   * console.log(result);
   * ```
   */
  async snapshot(args) {
      return new Promise((resolve, reject) => {
          if (!this.vmFunctions.asyncSnapshotFunction)
              return reject(new Error('[BotGuardClient]: Async snapshot function not found'));
          this.vmFunctions.asyncSnapshotFunction((response) => resolve(response), [
              args.contentBinding,
              args.signedTimestamp,
              args.webPoSignalOutput,
              args.skipPrivacyBuffer
          ]);
      });
  }
  /**
   * Takes a snapshot synchronously.
   * @returns The snapshot result.
   * @throws Error Throws an error if the synchronous snapshot function is not found.
   */
  async snapshotSynchronous(args) {
      if (!this.syncSnapshotFunction)
          throw new Error('[BotGuardClient]: Sync snapshot function not found');
      return this.syncSnapshotFunction([
          args.contentBinding,
          args.signedTimestamp,
          args.webPoSignalOutput,
          args.skipPrivacyBuffer
      ]);
  }
  /**
   * Passes an event to the VM.
   * @throws Error Throws an error if the pass event function is not found.
   */
  passEvent(args) {
      if (!this.vmFunctions.passEventFunction)
          throw new Error('[BotGuardClient]: Pass event function not found');
      this.vmFunctions.passEventFunction(args);
  }
  /**
   * Checks the "camera".
   * @throws Error Throws an error if the check camera function is not found.
   */
  checkCamera(args) {
      if (!this.vmFunctions.checkCameraFunction)
          throw new Error('[BotGuardClient]: Check camera function not found');
      this.vmFunctions.checkCameraFunction(args);
  }
  /**
   * Shuts down the VM. Taking a snapshot after this will throw an error.
   * @throws Error Throws an error if the shutdown function is not found.
   */
  shutdown() {
      if (!this.vmFunctions.shutdownFunction)
          throw new Error('[BotGuardClient]: Shutdown function not found');
      this.vmFunctions.shutdownFunction();
  }
}

// ########################################################################################################################################################################


const GOOG_BASE_URL = 'https://jnn-pa.googleapis.com';
const YT_BASE_URL = 'https://www.youtube.com';
const GOOG_API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36(KHTML, like Gecko)';

// ########################################################################################################################################################################

const base64urlCharRegex = /[-_.]/g;
const base64urlToBase64Map = {
    '-': '+',
    _: '/',
    '.': '='
};
function base64ToU8(base64) {
    let base64Mod;
    if (base64urlCharRegex.test(base64)) {
        base64Mod = base64.replace(base64urlCharRegex, function (match) {
            return base64urlToBase64Map[match];
        });
    }
    else {
        base64Mod = base64;
    }
    base64Mod = atob(base64Mod);
    const result = new Uint8Array([...base64Mod].map((char) => char.charCodeAt(0)));
    return result;
}
function u8ToBase64(u8, base64url = false) {
    const result = btoa(String.fromCharCode(...u8));
    if (base64url) {
        return result
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
    }
    return result;
}
function buildURL(endpointName, useYouTubeAPI) {
    return `${useYouTubeAPI ? YT_BASE_URL : GOOG_BASE_URL}/${useYouTubeAPI ? 'api/jnn/v1' : '$rpc/google.internal.waa.v1.Waa'}/${endpointName}`;
}

// ########################################################################################################################################################################

async function Challenge(bgConfig, interpreterHash) {
    const requestKey = bgConfig.requestKey;
    if (!bgConfig.fetch)
        throw new Error('[Challenge]: Fetch function not provided');
    const payload = [requestKey];
    if (interpreterHash)
        payload.push(interpreterHash);
    const response = await bgConfig.fetch(buildURL('Create', bgConfig.useYouTubeAPI), {
        method: 'POST',
        headers: {
            'content-type': 'application/json+protobuf',
            'x-goog-api-key': GOOG_API_KEY,
            'x-user-agent': 'grpc-web-javascript/0.1'
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok)
        throw new Error(`[Challenge]: Failed to fetch challenge: ${response.status}`);
    const rawData = await response.json();
    return parseChallengeData(rawData);
}
/**
 * Parses the challenge data from the provided response data.
 */
function parseChallengeData(rawData) {
    let challengeData = [];
    if (rawData.length > 1 && typeof rawData[1] === 'string') {
        const descrambled = descramble(rawData[1]);
        challengeData = JSON.parse(descrambled || '[]');
    }
    else if (rawData.length && typeof rawData[0] === 'object') {
        challengeData = rawData[0];
    }
    const [messageId, wrappedScript, wrappedUrl, interpreterHash, program, globalName, , clientExperimentsStateBlob] = challengeData;
    const privateDoNotAccessOrElseSafeScriptWrappedValue = Array.isArray(wrappedScript) ? wrappedScript.find((value) => value && typeof value === 'string') : null;
    const privateDoNotAccessOrElseTrustedResourceUrlWrappedValue = Array.isArray(wrappedUrl) ? wrappedUrl.find((value) => value && typeof value === 'string') : null;
    return {
        messageId,
        interpreterJavascript: {
            privateDoNotAccessOrElseSafeScriptWrappedValue,
            privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
        },
        interpreterHash,
        program,
        globalName,
        clientExperimentsStateBlob
    };
}
/**
 * Descrambles the given challenge data.
 */
function descramble(scrambledChallenge) {
    const buffer = base64ToU8(scrambledChallenge);
    if (buffer.length)
        return new TextDecoder().decode(buffer.map((b) => b + 97));
}

// ########################################################################################################################################################################


class WebPoMinter {
    constructor(mintCallback) {
        this.mintCallback = mintCallback;
    }
    static async create(integrityTokenResponse, webPoSignalOutput) {
        const getMinter = webPoSignalOutput[0];
        if (!getMinter)
            throw new Error('PMD:Undefined');
        const mintCallback = await getMinter(base64ToU8(integrityTokenResponse.integrityToken ?? ''));
        if (!(mintCallback instanceof Function))
            throw new Error('APF:Failed');
        return new WebPoMinter(mintCallback);
    }
    async mintAsWebsafeString(identifier) {
        const result = await this.mint(identifier);
        return u8ToBase64(result, true);
    }
    async mint(identifier) {
        const result = await this.mintCallback(new TextEncoder().encode(identifier));
        if (!result)
            throw new Error('YNJ:Undefined');
        if (!(result instanceof Uint8Array))
            throw new Error('ODM:Invalid');
        return result;
    }
}


// #########################################################################################################################################################################

async function generate(args) {
    const { program, bgConfig, globalName } = args;
    const { identifier } = bgConfig;
    const botguard = await BotGuardClient.create({ program, globalName, globalObj: bgConfig.globalObj });
    const webPoSignalOutput = [];
    const botguardResponse = await botguard.snapshot({ webPoSignalOutput });
    const payload = [bgConfig.requestKey, botguardResponse];
    const integrityTokenResponse = await bgConfig.fetch(buildURL('GenerateIT', bgConfig.useYouTubeAPI), {
        method: 'POST',
        headers: {
            'content-type': 'application/json+protobuf',
            'x-goog-api-key': GOOG_API_KEY,
            'x-user-agent': 'grpc-web-javascript/0.1'
        },
        body: JSON.stringify(payload)
    });
    const integrityTokenJson = await integrityTokenResponse.json();
    const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = integrityTokenJson;
    const integrityTokenData = {
        integrityToken,
        estimatedTtlSecs,
        mintRefreshThreshold,
        websafeFallbackToken
    };
    const webPoMinter = await WebPoMinter.create(integrityTokenData, webPoSignalOutput);
    const poToken = await webPoMinter.mintAsWebsafeString(identifier);
    return { poToken, integrityTokenData };
}

function generatePlaceholder(identifier, clientState) {
    const encodedIdentifier = new TextEncoder().encode(identifier);
    if (encodedIdentifier.length > 118)
        throw new Error('DFO:Invalid');
    const timestamp = Math.floor(Date.now() / 1000);
    const randomKeys = [Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)];
    // NOTE: The "0" value before the client state is supposed to be someVal & 0xFF.
    // It is always 0 though, so I didn't bother investigating further.
    const header = randomKeys.concat([
        0, (clientState ?? 1)
    ], [
        (timestamp >> 24) & 0xFF,
        (timestamp >> 16) & 0xFF,
        (timestamp >> 8) & 0xFF,
        timestamp & 0xFF
    ]);
    const packet = new Uint8Array(2 + header.length + encodedIdentifier.length);
    packet[0] = 34;
    packet[1] = header.length + encodedIdentifier.length;
    packet.set(header, 2);
    packet.set(encodedIdentifier, 2 + header.length);
    const payload = packet.subarray(2);
    const keyLength = randomKeys.length;
    for (let i = keyLength; i < payload.length; i++) {
        payload[i] ^= payload[i % keyLength];
    }
    return u8ToBase64(packet, true);
}

// #########################################################################################################################################################################

import { JSDOM } from 'jsdom';

async function generatePoToken(params) {
    const requestKey = 'O43z0dpjhgX20SCx4KAo';
    const visitorData = params;

    if (!visitorData)
    throw new Error('Could not get visitor data');

    const dom = new JSDOM();

    Object.assign(globalThis, {
        window: dom.window,
        document: dom.window.document
    });

    const bgConfig = {
        fetch: (input, init) => fetch(input, init),
        globalObj: globalThis,
        identifier: visitorData,
        requestKey
    };

    const bgChallenge = await Challenge(bgConfig);

    if (!bgChallenge)
        throw new Error('Could not get challenge');

    const interpreterJavascript = bgChallenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;

    if (interpreterJavascript) {
        new Function(interpreterJavascript)();
    } else throw new Error('Could not load VM');

    const poTokenResult = await generate({
        program: bgChallenge.program,
        globalName: bgChallenge.globalName,
        bgConfig
    });

    console.info(poTokenResult.poToken);

}

const args = process.argv.slice(2);

generatePoToken(args)