import fetch from 'node-fetch';
import getPixels from "get-pixels";
import WebSocket from 'ws';

const VERSION_NUMBER = 5;

console.log(`r/place autism headless client V${VERSION_NUMBER}`);

const args = process.argv.slice(2);

//if (args.length != 1 && !process.env.ACCESS_TOKEN) {
//    console.error("Missing access token.")
//    process.exit(1);
//}
if (args.length != 1 && !process.env.REDDIT_SESSION) {
    console.error("Missing reddit_session cookie.")
    process.exit(1);
}

let redditSessionCookies = (process.env.REDDIT_SESSION || args[0]).split(';');

var hasTokens = false;

let accessTokens;
let defaultAccessToken;

if (redditSessionCookies.length > 4) {
    console.warn("More than 4 reddit accounts per IP address is not recommended!")
}

var socket;
var currentOrders;
var currentOrderList;

COLOR_MAPPINGS = {
    '#6D001A': 1,
    '#BE0039': 2,
    '#FF4500': 3,
    '#FFA800': 4,
    '#FFD635': 5,
    '#00A368': 6,
    '#00CC78': 7,
    '#0D1117': 8,
    '#7EED56': 9,
    '#00756F': 10,
    '#009EAA': 11,
    '#00CCC0': 12,
    '#2450A4': 13,
    '#3690EA': 14,
    '#51E9F4': 15,
    '#493AC1': 16,
    '#6A5CFF': 17,
    '#94B3FF': 18,
    '#811E9F': 19,
    '#B44AC0': 20,
    '#E4ABFF': 21,
    '#DE107F': 22,
    '#FF3881': 23,
    '#FF99AA': 24,
    '#6D482F': 25,
    '#9C6926': 26,
    '#FFB470': 27,
    '#000000': 28,
    '#515252': 29,
    '#898D90': 30,
    '#D4D7D9': 31,
    '#FFFFFF': 32,
};

let rgbaJoin = (a1, a2, rowSize = 1000, cellSize = 4) => {
    const rawRowSize = rowSize * cellSize;
    const rows = a1.length / rawRowSize;
    let result = new Uint8Array(a1.length + a2.length);
    for (var row = 0; row < rows; row++) {
        result.set(a1.slice(rawRowSize * row, rawRowSize * (row+1)), rawRowSize * 2 * row);
        result.set(a2.slice(rawRowSize * row, rawRowSize * (row+1)), rawRowSize * (2 * row + 1));
    }
    return result;
};

let getRealWork = rgbaOrder => {
    let order = [];
    for (var i = 0; i < 4000000; i++) {
        if (rgbaOrder[(i * 4) + 3] !== 0) {
            order.push(i);
        }
    }
    return order;
};

let getPendingWork = (work, rgbaOrder, rgbaCanvas) => {
    let pendingWork = [];
    for (const i of work) {
        if (rgbaOrderToHex(i, rgbaOrder) !== rgbaOrderToHex(i, rgbaCanvas)) {
            pendingWork.push(i);
        }
    }
    return pendingWork;
};

(async function () {
    refreshTokens();
    connectSocket();

    startPlacement();

    setInterval(() => {
        if (socket) socket.send(JSON.stringify({ type: 'ping' }));
    }, 5000);
    // Refresh the tokens every 30 minuts. Has to be enough right?
    setInterval(refreshTokens, 30 * 60 * 1000);
})();

function startPlacement() {
    if (!hasTokens) {
        // Try again in a second.
        setTimeout(startPlacement, 1000);
        return
    }

    // Try to stagger pixel placement
    const interval = 300 / accessTokens.length;
    var delay = 0;
    for (const accessToken of accessTokens) {
        setTimeout(() => attemptPlace(accessToken), delay * 1000);
        delay += interval;
    }
}

async function refreshTokens() {
    let tokens = [];
    for (const cookie of redditSessionCookies) {
        const response = await fetch("https://www.reddit.com/r/place/", {
            headers: {
                cookie: `reddit_session=${cookie}`
            }
        });
        const responseText = await response.text()

        let token = responseText.split('\"accessToken\":\"')[1].split('"')[0];
        tokens.push(token);
    }

    console.log("Refreshed tokens: ", tokens)

    accessTokens = tokens;
    defaultAccessToken = tokens[0];
    hasTokens = true;
}

function connectSocket() {
    console.log('Connecting with r/place autism server...')

    socket = new WebSocket('wss://placenl.noahvdaa.me/api/ws');

    socket.onerror = function(e) {
        console.error("Socket error: " + e.message)
    }

    socket.onopen = function () {
        console.log('Connected with r/place autism server!')
        socket.send(JSON.stringify({ type: 'getmap' }));
        socket.send(JSON.stringify({ type: 'brand', brand: `nodeheadlessV${VERSION_NUMBER}` }));
    };

    socket.onmessage = async function (message) {
        var data;
        try {
            data = JSON.parse(message.data);
        } catch (e) {
            return;
        }

        switch (data.type.toLowerCase()) {
            case 'map':
                console.log(`New mad loaded (reason: ${data.reason ? data.reason : 'Connected to server'})`)
                currentOrders = await getMapFromUrl(`https://placenl.noahvdaa.me/maps/${data.data}`);
                currentOrderList = getRealWork(currentOrders.data);
                break;
            default:
                break;
        }
    };

    socket.onclose = function (e) {
        console.warn(`r/place autism server has broken the connection: ${e.reason}`)
        console.error('Socket error: ', e.reason);
        socket.close();
        setTimeout(connectSocket, 1000);
    };
}

async function attemptPlace(accessToken) {
    let retry = () => attemptPlace(accessToken);
    if (currentOrderList === undefined) {
        setTimeout(retry, 2000); // probeer opnieuw in 2sec.
        return;
    }
    
    var map0;
    var map1;
    try {
        map0 = await getMapFromUrl(await getCurrentImageUrl('0'))
        map1 = await getMapFromUrl(await getCurrentImageUrl('1'));
    } catch (e) {
        console.warn('Error retrieving map: ', e);
        setTimeout(retry, 15000); // probeer opnieuw in 15sec.
        return;
    }

    const rgbaOrder = currentOrders.data;
    const rgbaCanvas = rgbaJoin(map0.data, map1.data);
    const work = getPendingWork(currentOrderList, rgbaOrder, rgbaCanvas);

    if (work.length === 0) {
        console.log(`All pixels are correct! Trying again in 30 sec...`);
        setTimeout(retry, 30000); // probeer opnieuw in 30sec.
        return;
    }

    const percentComplete = 100 - Math.ceil(work.length * 100 / currentOrderList.length);
    const workRemaining = work.length;
    const idx = Math.floor(Math.random() * work.length);
    const i = work[idx];
    const x = i % 2000;
    const y = Math.floor(i / 2000);
    const hex = rgbaOrderToHex(i, rgbaOrder);

    console.log(`Trying to move pixel at ${x}, ${y}... (${percentComplete}% complete, ${workRemaining} left)`);

    const res = await place(x, y, COLOR_MAPPINGS[hex], accessToken);
    const data = await res.json();
    try {
        if (data.errors) {
            const error = data.errors[0];
            if (error.extensions && error.extensions.nextAvailablePixelTimestamp) {
                const nextPixel = error.extensions.nextAvailablePixelTs + 3000;
                const nextPixelDate = new Date(nextPixel);
                const delay = nextPixelDate.getTime() - Date.now();
                console.log(`Pixel moved too fast! Next pixel is moved at ${nextPixelDate.toLocaleTimeString()}.`)
                setTimeout(retry, delay);
            } else {
                console.error(`[!!] Critical error: ${error.message}. Did you copy the 'reddit_session' cookie correctly?`);
                console.error(`[!!] Fix this by restarting the script`);
            }
        } else {
            const nextPixel = data.data.act.data[0].data.nextAvailablePixelTimestamp + 3000;
            const nextPixelDate = new Date(nextPixel);
            const delay = nextPixelDate.getTime() - Date.now();
            console.log(`Pixel placed at ${x}, ${y}! next pixel will be moved at ${nextPixelDate.toLocaleTimeString()}.`)
            setTimeout(retry, delay);
        }
    } catch (e) {
        console.warn('Error proccessing response', e);
        setTimeout(retry, 10000);
    }
}

function place(x, y, color, accessToken = defaultAccessToken) {
    socket.send(JSON.stringify({ type: 'placepixel', x, y, color }));
	return fetch('https://gql-realtime-2.reddit.com/query', {
		method: 'POST',
		body: JSON.stringify({
			'operationName': 'setPixel',
			'variables': {
				'input': {
					'actionName': 'r/replace:set_pixel',
					'PixelMessageData': {
						'coordinate': {
							'x': x % 1000,
							'y': y % 1000
						},
						'colorIndex': color,
						'canvasIndex': (x > 999 ? 1 : 0)
					}
				}
			},
			'query': 'mutation setPixel($input: ActInput!) {\n  act(input: $input) {\n    data {\n      ... on BasicMessage {\n        id\n        data {\n          ... on GetUserCooldownResponseMessageData {\n            nextAvailablePixelTimestamp\n            __typename\n          }\n          ... on SetPixelResponseMessageData {\n            timestamp\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n'
		}),
		headers: {
			'origin': 'https://hot-potato.reddit.com',
			'referer': 'https://hot-potato.reddit.com/',
			'apollographql-client-name': 'mona-lisa',
			'Authorization': `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		}
	});
}

async function getCurrentImageUrl(id = '0') {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket('wss://gql-realtime-2.reddit.com/query', 'graphql-ws', {
        headers : {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:98.0) Gecko/20100101 Firefox/98.0",
            "Origin": "https://hot-potato.reddit.com"
        }
      });

		ws.onopen = () => {
			ws.send(JSON.stringify({
				'type': 'connection_init',
				'payload': {
					'Authorization': `Bearer ${defaultAccessToken}`
				}
			}));

			ws.send(JSON.stringify({
				'id': '1',
				'type': 'start',
				'payload': {
					'variables': {
						'input': {
							'channel': {
								'teamOwner': 'AFD2022',
								'category': 'CANVAS',
								'tag': id
							}
						}
					},
					'extensions': {},
					'operationName': 'replace',
					'query': 'subscription replace($input: SubscribeInput!) {\n  subscribe(input: $input) {\n    id\n    ... on BasicMessage {\n      data {\n        __typename\n        ... on FullFrameMessageData {\n          __typename\n          name\n          timestamp\n        }\n      }\n      __typename\n    }\n    __typename\n  }\n}'
				}
			}));
		};

		ws.onmessage = (message) => {
			const { data } = message;
			const parsed = JSON.parse(data);

            if (parsed.type === 'connection_error') {
                console.error(`[!!] Couldn't load the /r/place map : ${parsed.payload.message}. Is the access token invalid?`);
            }

			// TODO: ew
			if (!parsed.payload || !parsed.payload.data || !parsed.payload.data.subscribe || !parsed.payload.data.subscribe.data) return;

			ws.close();
			resolve(parsed.payload.data.subscribe.data.name + `?noCache=${Date.now() * Math.random()}`);
		}


		ws.onerror = reject;
	});
}

function getMapFromUrl(url) {
    return new Promise((resolve, reject) => {
        getPixels(url, function(err, pixels) {
            if(err) {
                console.log("Bad image path")
                reject()
                return
            }
            resolve(pixels)
        })
    });
}

function rgbToHex(r, g, b) {
	return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

let rgbaOrderToHex = (i, rgbaOrder) =>
    rgbToHex(rgbaOrder[i * 4], rgbaOrder[i * 4 + 1], rgbaOrder[i * 4 + 2]);
