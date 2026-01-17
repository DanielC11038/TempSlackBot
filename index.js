const{ App, SocketModeReceiver } = require('@slack/bolt')
require('dotenv').config()
const axios = require('axios')
const OpenAI = require('openai')
const fs = require('fs')
const path = require('path')


const new_app = new App( {
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
})


// OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAIKEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });


//Bot Commands
new_app.command('/hello', async ({ command, ack, say }) => {
    await ack()


    await say(`Hello <@${command.user_id}>`)
})


const API_URL = 'https://api.openai.com/v1/chat/completions' //defines URL your question goes to
const API_KEY = process.env.OPENAIKEY
const CHAT_INSTRUCTIONS = process.env.CHAT_INSTRUCTIONS || ""


async function getChatResponse(prompt, eventKey = null, vectorContext = null) {
    try {
        //console.log("sending prompt to chatgpt") //debug
        const messages = [];
        if(CHAT_INSTRUCTIONS !== undefined && CHAT_INSTRUCTIONS.length > 0) {
            messages.push({ role: "system", content: CHAT_INSTRUCTIONS });
            //messages.push({ role: "user", content: prompt });
        }

        // Retrieve hard facts if eventKey exists
        let eventFacts = "";
        if (eventKey) {
            eventFacts = getEventFacts(eventKey);
        }

        // Build user message combining hard facts and vector store context
        const usersContentParts = [];
        if (eventFacts)
            usersContentParts.push(`Authoritative Stats:\n${eventFacts}`);
        if (vectorContext)
            usersContentParts.push(`Additional Context:\n${vectorContext}`);
       
        usersContentParts.push(`Question:\n${prompt}`);
        //console.log(messages)

        messages.push({ role: "user", content: usersContentParts.join('\n\n') }); //

        const response = await axios.post(
            API_URL, //where axios sends the request
            {
                model: OPENAI_MODEL,
                messages: messages,
                max_tokens: 500, //limit response length
            },
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`, //authenticates request
                    'Content-Type': 'application/json',
                },
            }
        )
        console.log("received response:", response.data) //debug
        return response.data.choices[0].message.content /*|| ""*/ //returns the first answer by ChatGPT
    } catch (error) {
        console.error("Error calling ChatGPT API:", error.response ? error.response.data : error.message) //debug
        return `Error calling ChatGPT API: ${error.response ? JSON.stringify(error.response.data) : error.message}`
    }
}


//const BLUE_FILE = process.env.BLUEALLIANCEFILE
// Retrieve file content API
//const FILE_LINK = 'https://api.openai.com/v1/files/' + BLUE_FILE + '/content'


//Blue alliance GET functions
const TBA_KEY = process.env.TBA_KEY;

// Local data directory
const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) 
    fs.mkdirSync(DATA_DIR, { recursive: true });

const vectorStoresByEvent = new Map(); // Simple in-memory mapping: event_key -> vector_data_id

const VS_MAP_FILE = path.join(DATA_DIR, 'vector_stores.json');

function loadVectorStoreMap() {
    if (fs.existsSync(VS_MAP_FILE)) {
        try {
            const obj = JSON.parse(fs.readFileSync(VS_MAP_FILE, 'utf8')) || {};
            
            for (const [k, v] of Object.entries(obj)) vectorStoresByEvent.set(k, v);
                console.log('Loaded vectorStoresByEvent from', VS_MAP_FILE);

        } catch (e) {
            console.error('Failed loading vector store map:', e && e.message || e);
        }
    }
}

function saveVectorStoreMap() {
    try {
        const obj = Object.fromEntries(vectorStoresByEvent);
        fs.writeFileSync(VS_MAP_FILE, JSON.stringify(obj, null, 2));
        console.log('Saved vectorStoresByEvent to', VS_MAP_FILE);
    } catch (e) {
        console.error('Failed saving vector store map:', e && e.message || e);
    }
}

// load persisted map on startup
loadVectorStoreMap();

// persist on exit signals
process.on('SIGINT', () => { 
    try { saveVectorStoreMap(); 
    } catch(_){}; 
    process.exit(); 
});
process.on('SIGTERM', () => { 
    try { saveVectorStoreMap(); 
    } catch(_){}; 
    process.exit(); 
});

// Build combined list of event keys from local files and vectorStoresByEvent
function buildEventOptions() {
    try {
        const files = fs.readdirSync(DATA_DIR || '.');
        const localKeys = files.filter(f => f.endsWith('_event.json')).map(f => f.replace('_event.json',''));
        const vsKeys = Array.from(vectorStoresByEvent.keys());
        const all = Array.from(new Set([...localKeys, ...vsKeys]));
        // create Slack option objects with marker if vector store exists
        return all.map(k => ({ text: { type: 'plain_text', text: `${k}${vectorStoresByEvent.has(k) ? ' (vector store available)' : ''}` }, value: k }));
    } catch (e) {
        console.error('buildEventOptions error:', e && e.message || e);
        return [];
    }
}


async function tba(pathFragment) {
    if(!TBA_KEY) {
        throw new Error("No Blue Alliance file specified in environment variable BLUEALLIANCEFILE") //no
}    
   
    const url = `https://www.thebluealliance.com/api/v3/${pathFragment}`;
    const res = await axios.get(url, {headers: {'X-TBA-Auth-Key': TBA_KEY}});
       
    return res.data;  
}


function writeJSON(filePath, obj) {
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}


async function buildTBAFiles(eventKey) {
    const [event, teams, matches, rankings] = await Promise.all([ tba('/event/' + eventKey),
        tba('/event/' + eventKey + '/teams/simple'),
        tba('/event/' + eventKey + '/matches'),
        tba('/event/' + eventKey + '/rankings') ]);
   
    const eventPath = path.join(DATA_DIR, eventKey + '_event.json');
    const teamsPath = path.join(DATA_DIR, eventKey + '_teams.json');
    const matchesPath = path.join(DATA_DIR, eventKey + '_matches.json');
    const rankingsPath = path.join(DATA_DIR, eventKey + '_rankings.json');
    const metricsPath = path.join(DATA_DIR, eventKey + '_team_metrics.json');

    writeJSON(eventPath, event);
    writeJSON(teamsPath, teams);
    writeJSON(rankingsPath, rankings);

    const matchRows = matches.map(m => ({
        match_key: m.key,
        event_key: m.event_key,
        comp_level: m.comp_level,
        match_number: m.match_number,
        set_number: m.set_number,
        time: m.time || m.predicted_time || null,
        actual_time: m.actual_time || null,
        alliances: {
            red: {
                teams: m.alliances?.red?.team_keys || [],
                score: m.alliances?.red?.score
            },
            blue: {
                teams: m.alliances?.blue?.team_keys || [],
                score: m.alliances?.blue?.score
            }
        },
        score_breakdown: m.score_breakdown || null
    }));

    writeJSON(matchesPath, matchRows);

    const metrics = computeTeamMetrics(matches, eventKey);
    writeJSON(metricsPath, metrics);

    return {eventPath, teamsPath, matchesPath, rankingsPath, metricsPath};
}


// Derived minimal team metrics (W/L/T + avg alliance score)
function computeTeamMetrics(matches, eventKey) {
    const byTeam = new Map();
    const get = (k) => byTeam.get(k) || (byTeam.set(k, { w: 0, l: 0, t: 0, total: 0, games: 0 }), byTeam.get(k));

    for (const m of matches) {
        const red = m.alliances?.red;
        const blue = m.alliances?.blue;
    if (!red || !blue) continue; //skip if missing alliance data
        const redscore = red.score;
        const bluescore = blue.score;
        const scored = Number.isFinite(redscore) && Number.isFinite(bluescore) && redscore >= 0 && bluescore >= 0;
        const redWon = scored && redscore > bluescore;
        const tie = scored && redscore === bluescore;
        for (const t of red.team_keys || []) {
            const cur = get(t);
                if (scored) {
                    if(tie)
                        cur.t += 1;
                    else if(redWon)
                        cur.w += 1;
                    else
                        cur.l += 1;
                }
            cur.games += 1;
            cur.total += redscore;
            //byTeam.set(t, cur);
        }
        for (const t of blue.team_keys || []) {
            const cur = get(t);
            if (scored) {
                if (tie)
                    cur.t += 1;
                else if (!redWon)
                    cur.w += 1;
                else
                    cur.l += 1;
            }
            cur.games += 1;
            cur.total += bluescore;
            //byTeam.set(t, cur);
        }
    /*fs.writeFileSync(metricsPath, '');
    for (const [teamKey, metrics] of byTeam) {
        appendJSONL(metricsPath, { team_key,
        event_key: eventKey,
        wl: {w: metrics.w, l: metrics.l, t: metrics.t},
        avg_alliance_score: metrics.games? metrics.total / metrics.games : null }); } */
    }
    const out = [];
    for (const [teamKey, T] of byTeam) {  
        out.push({ team_key: teamKey,
            event_key: eventKey,
            wl: { w: T.w, l: T.l, t: T.t },
            avg_alliance_score: T.games ? T.total / T.games : null });
    }
   
    return out;
}


//OpenAI storage: vector store and uploads
async function createOrGetVectorStore(name) {
    const vs = await openai.vectorStores.create({name});
    console.log('vector store create response:', vs);
    // The client may return the id in different shapes; ensure we return a string id.
    if (vs && typeof vs.id === 'string') return vs.id;
    if (vs && vs.data && typeof vs.data.id === 'string') 
        return vs.data.id;
    if (typeof vs === 'string') 
        return vs;
    throw new Error('Unable to determine vector store id from create response: ' + JSON.stringify(vs));
}


async function uploadAndAttachFilesToVectorStore(vectorStoreID, filePaths) { //upload files
    const fileIDs = [];
    for (const f of filePaths) {
        const file = await openai.files.create({file: fs.createReadStream(f),
            purpose: 'assistants'});
        fileIDs.push(file.id); //Attach to Vector Store
    }
    //await openai.vectorStores.files.create({vector_store_id: vectorStoreID,
       //     file_ids: fileIDs});

    return fileIDs;
}


async function waitForIndexing(vectorStoreID, timeoutMs = 60000) {
    console.log('waitForIndexing received vectorStoreID:', vectorStoreID, 'type:', typeof vectorStoreID);
    let id = vectorStoreID;
    if (id && typeof id === 'object') {
        if (typeof id.id === 'string') id = id.id;
        else if (id.data && typeof id.data.id === 'string') id = id.data.id;
        else {
            console.warn('waitForIndexing: unable to extract id from object, using JSON string.');
            id = JSON.stringify(id);
        }
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const list = await openai.vectorStores.files.list({vector_store_id: id});
            console.log('vectorStores.files.list response:', list && (list.data || list));
            const files = list.data  || [];
            const allProcessed = files.length > 0 && files.every(f => (f.status || '').toLowerCase() === 'processed');
            if(allProcessed) 
                return true;
        } catch (err) {
            console.error('Error listing vector store files:', err.response ? err.response.data : err.message || err);
        }
        await new Promise(r => setTimeout(r,2000));
    }
    return false;
}


// -------- Ask with retrieval (uses vector store) --------
async function askWithVectorStore({ question, vectorStoreId }) {
    try {
        const resp = await openai.responses.create({ model: OPENAI_MODEL,
            input: [ { role: 'system', content: CHAT_INSTRUCTIONS }, { role: 'user', content: question } ],
            tools: [{ type: 'file_search' }],
            tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } }, temperature: 0.2 });
        return resp.output_text || (resp.choices?.[0]?.message?.content || '');
    } catch (err) {
        // Log error and return null so callers can fallback to local retrieval
        console.error('askWithVectorStore error:', err && (err.response ? err.response.data : err.message || err));
        // If API complains about unknown parameter 'tool_resources', treat as unsupported
        const msg = err && (err.response ? JSON.stringify(err.response.data) : err.message || '');
        if (typeof msg === 'string' && msg.includes('tool_resources')) {
            console.warn('Responses API rejected tool_resources; falling back to local retrieval.');
            return null;
        }
        return null;
    }
}


function formatMatchLabel(m) {
    const level = (m.comp_level || '').toLowerCase();

    switch (level) {
        case 'qm':
            return `Qualification Match #${m.match_number}`;
        case 'qf':
            return `Quarterfinal ${m.set_number} – Match ${m.match_number}`;
        case 'sf':
            return `Semifinal ${m.set_number} – Match ${m.match_number}`;
        case 'f':
            return `Final – Match ${m.match_number}`;
        default:
            return `Match #${m.match_number || 'N/A'}`;
    }
}

// Local retrieval fallback when Responses API tool_resources is unsupported
async function localRetrieveEvent(eventKey, question) {
    try {
        const matchesPath = path.join(DATA_DIR, `${eventKey}_matches.json`);
        if (!fs.existsSync(matchesPath)) return null;
        const rows = JSON.parse(fs.readFileSync(matchesPath, 'utf-8')) || [];
        // Prefer finals/ playoff matches if present
        const finals = rows.filter(r => (r.comp_level || '').toLowerCase().startsWith('f'));
        const sample = (finals.length ? finals : rows).slice(-5);
        if (!sample || sample.length === 0) return null;
        const lines = sample.map(m => {
            const rteams = (m.alliances && m.alliances.red && m.alliances.red.teams) ? m.alliances.red.teams.join(', ') : '';
            const bteams = (m.alliances && m.alliances.blue && m.alliances.blue.teams) ? m.alliances.blue.teams.join(', ') : '';
            const rscore = m.alliances?.red?.score ?? 'N/A';
            const bscore = m.alliances?.blue?.score ?? 'N/A';
            //const mk = m.match_key || `${m.comp_level || ''} ${m.match_number || ''}`;
            const mk = formatMatchLabel(m);
            return `Match ${mk}: Red(${rteams}) ${rscore} vs Blue(${bteams}) ${bscore}`;
        });
        return lines.join('\n');
    } catch (e) {
        console.error('localRetrieveEvent error:', e && e.message || e);
        return null;
    }
}


// -------- slack commands --------


// Upload Blue Alliance data to OpenAI storage and create a vector store // Usage: /upload 2025casj
new_app.command('/upload', async ({ command, ack, say }) => {
    await ack();
    const eventKey = (command.text || '').trim();
    if (!eventKey) return say('Usage: /upload <event_key> (e.g., 2025casj)');
    try {
        //await say('Fetching TBA data for' + eventKey + '…');
        await say(`Fetching TBA data for ${eventKey}…`  );

        const paths = await buildTBAFiles(eventKey);

        await say('Creating vector store and uploading files to OpenAI…');
        const vsId = await createOrGetVectorStore(`tba-${eventKey}-${Date.now()}`);
        console.log('createOrGetVectorStore returned:', vsId, 'type:', typeof vsId);

        for (const f of [paths.eventPath, paths.teamsPath, paths.matchesPath, paths.rankingsPath, paths.metricsPath]) {
            await openai.files.create({ file: fs.createReadStream(f), purpose: 'assistants' });
        }

        await say('Indexing files… this can take a moment.');
        const indexed = await waitForIndexing(vsId, 60000);
        if (!indexed)
            await say('Warning: Indexing may still be in progress, but you can try asking now.');

        vectorStoresByEvent.set(eventKey, vsId);
        await say(`Done. Vector store ready for ${eventKey}. vector_store_id: ${vsId}\nAsk with: /chat ${eventKey} <your question>`);
    } catch (e) {
         await say('Upload failed: ' + (e.response ? JSON.stringify(e.response.data) : e.message));
    }
});


/*
async function retrieveFile() {
    try {
        const response = await axios.get(
            FILE_LINK, //where axios gets the file content
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`, //authenticates request
                    'Content-Type': 'application/json',
                },
            }
        )
        console.log("received response:", response.data)
        return response.data //returns the file content
    } catch (error) {
        console.error("Error Get the file:", error.response ? error.response.data : error.message)
    }
}
*/


(async () => {
    //start your app
    await new_app.start(process.env.PORT || 3000)
    console.log(`Bot app is running on port ${process.env.PORT || 3000}!` )
   // console.log()
}) ()


function getEventFacts(eventKey) {
    const metricsPath = path.join(DATA_DIR, `${eventKey}_team_metrics.json`);
    if (!fs.existsSync(metricsPath)) return "No metrics available.";

    const metrics = JSON.parse(
        fs.readFileSync(metricsPath, 'utf-8')
    );

    return metrics.map(m =>
        `Team ${m.team_key}: W/L/T = ${m.wl.w}/${m.wl.l}/${m.wl.t}, 
            Avg Alliance Score = ${Number.isFinite(m.avg_alliance_score)
                ? m.avg_alliance_score.toFixed(1)
                : "N/A"
        }`
    ).join('\n');
}


new_app.command('/chat', async ({ command, ack, /*say*/ client }) => {
    await ack()

    const text = command.text.trim();
    let eventKey = null;
    let question = text;

    // Extract optional eventKey (first word) if it exists
    const parts = text.split(" ");
    if (parts.length > 1 && vectorStoresByEvent.has(parts[0])) {
        eventKey = parts[0];
        question = parts.slice(1).join(" ");
    }

    // If still no eventKey, present a checkbox modal listing stored/local event keys
    if (!eventKey) {
        try {
            const options = buildEventOptions();
            if (options.length > 0) {
                await client.views.open({
                    trigger_id: command.trigger_id,
                    view: {
                        type: 'modal',
                        callback_id: 'choose_event_modal',
                        private_metadata: JSON.stringify({ channel_id: command.channel_id, invoking_user: command.user_id, question: question }),
                        title: { type: 'plain_text', text: 'Choose Event' },
                        submit: { type: 'plain_text', text: 'Select' },
                        close: { type: 'plain_text', text: 'Cancel' },
                        blocks: [
                            {
                                type: 'input',
                                block_id: 'event_select_block',
                                element: {
                                    type: 'checkboxes',
                                    action_id: 'event_checkbox_action',
                                    options: options
                                },
                                label: { type: 'plain_text', text: 'Choose an event to use as context' }
                            }
                        ]
                    }
                });
                return; // wait for selection
            }
        } catch (e) {
            console.error('Error opening choose_event_modal:', e && (e.response ? e.response.data : e.message || e));
        }
    }


    // If we have a vector store for this event, run a retrieval query
    let vectorContext = null;
    if (eventKey) {
        const vsId = vectorStoresByEvent.get(eventKey);
        if (vsId) {
            try {
                vectorContext = await askWithVectorStore({ question, vectorStoreId: vsId });
                console.log('askWithVectorStore returned:', typeof vectorContext === 'string' ? vectorContext.substring(0,200) : vectorContext);
            } catch (err) {
                console.error('askWithVectorStore error:', err.response ? err.response.data : err.message || err);
            }
        }
    }


    const answer = await getChatResponse(question, eventKey, vectorContext);

    await client.views.open({
        trigger_id: command.trigger_id, //calls (triggers) the creation of a modal
        view: {
            type: "modal",
            callback_id: "chat_modal",
            // pass the channel where the command was invoked so we can reply there
            private_metadata: JSON.stringify({ channel_id: command.channel_id,
                invoking_user: command.user_id,
                eventKey: eventKey || null,
                question, answer }),
            title: {
                type: "plain_text",
                text: "Chat"
            },
            close: { //close button
                type: "plain_text",
                text: "Cancel"
            },
            submit: { //submit button
                type: "plain_text",
                text: "Send"
            },
            blocks: [ //text input block
                {
                    type: 'section',
                    block_id: 'context_display',
                    text: { type: 'mrkdwn', text: `*Context:* ${eventKey || 'None'}` }
                },
                {
                    type: "input",
                    block_id: "user_prompt_block",
                    label: {
                        type: "plain_text",
                        text: "Your Question"
                    },
                    element: {
                        type: "plain_text_input",
                        action_id: "user_prompt_input",
                        multiline: true,
                        initial_value: question, //fills block with the original command text
                        placeholder: {
                            type: "plain_text",
                            text: "Enter your question here..."
                        }
                    }
                }
            ]
        }
     })
})

// Handler for event selection modal (checkboxes)
new_app.view('choose_event_modal', async ({ ack, body, view, client }) => {
    try {
        const meta = view.private_metadata ? JSON.parse(view.private_metadata) : {};
        const channelId = meta.channel_id || null;
        const question = meta.question || '';

        const sel = (view.state && view.state.values && view.state.values.event_select_block && view.state.values.event_select_block.event_checkbox_action && view.state.values.event_select_block.event_checkbox_action.selected_options) || [];
        if (!sel || sel.length === 0) {
            // Update modal to show an error message
            await ack({
                response_action: 'update',
                view: {
                    type: 'modal',
                    callback_id: 'choose_event_modal',
                    title: { type: 'plain_text', text: 'Choose Event' },
                    close: { type: 'plain_text', text: 'Close' },
                    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*No event selected.*' } }]
                }
            });
            return;
        }

        // support multiple selections: pick the first as primary
        const selectedKeys = sel.map(s => s.value);
        const primaryEvent = selectedKeys.length > 0 ? selectedKeys[0] : null;
        const privateMeta = { channel_id: channelId, eventKey: primaryEvent, question };

        // Replace the modal with the chat modal so user can edit/type their question
        await ack({
            response_action: 'update',
            view: {
                type: 'modal',
                callback_id: 'chat_modal',
                private_metadata: JSON.stringify(privateMeta),
                title: { type: 'plain_text', text: 'Chat' },
                close: { type: 'plain_text', text: 'Cancel' },
                submit: { type: 'plain_text', text: 'Send' },
                blocks: [
                    { type: 'section', block_id: 'context_display', text: { type: 'mrkdwn', text: `*Context:* ${primaryEvent || 'None'}` } },
                    { type: 'input', block_id: 'user_prompt_block', label: { type: 'plain_text', text: 'Your Question' }, element: { type: 'plain_text_input', action_id: 'user_prompt_input', multiline: true, initial_value: question, placeholder: { type: 'plain_text', text: 'Enter your question here...' } } }
                ]
            }
        });
    } catch (err) {
        console.error('choose_event_modal top-level error:', err && (err.stack || err));
        try {
            await ack({
                response_action: 'update',
                view: {
                    type: 'modal',
                    callback_id: 'choose_event_modal',
                    title: { type: 'plain_text', text: 'Error' },
                    close: { type: 'plain_text', text: 'Close' },
                    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*An error occurred. See logs.*' } }]
                }
            });
        } catch (e) {}
    }
});


    new_app.view('chat_modal', async ({ ack, body, view, client }) => {
    const userId = body.user.id;
    const prompt = view.state.values.user_prompt_block.user_prompt_input.value;

    // parse private metadata to get eventKey and channel
    let parsedMeta = {};
    try { parsedMeta = view.private_metadata ? JSON.parse(view.private_metadata) : {}; } catch (e) { parsedMeta = {}; }
    const eventKey = parsedMeta.eventKey || null;
    const channelId = parsedMeta.channel_id || null;

    // perform retrieval using eventKey if present
    let vectorContext = null;
    if (eventKey) {
        try {
            const vsId = vectorStoresByEvent.get(eventKey);
            if (vsId) {
                vectorContext = await askWithVectorStore({ question: prompt, vectorStoreId: vsId }).catch(err => {
                    console.error('askWithVectorStore error in chat_modal:', err && (err.response ? err.response.data : err.message || err));
                    return null;
                });
            }
            if (!vectorContext) {
                const local = await localRetrieveEvent(eventKey, prompt);
                if (local) vectorContext = local;
            }
        } catch (e) {
            console.error('chat_modal retrieval error:', e && (e.response ? e.response.data : e.message || e));
        }
    }

    // get answer from model using eventKey and vectorContext
    const answer = await getChatResponse(prompt, eventKey, vectorContext);

    // declaring the variable question
    const question = prompt;

    // prepare updated modal: show question (read-only) and the answer, plus a button to post to channel
    const privateMeta = { channel_id: channelId || null, eventKey: eventKey || null, question, answer };


    // Return the updated view in "ack" and allow Slack to keep the modal open and applies the update
    await ack({
        response_action: 'update',
        view: {
            type: "modal",
            callback_id: "chat_modal", // still the same id
            private_metadata: JSON.stringify(privateMeta),
            title: { type: "plain_text", text: "Chat" },
            close: { type: "plain_text", text: "Close" },
            blocks: [
                { // question block
                    type: "section",
                    block_id: "question_display",
                    text: {
                        type: "mrkdwn",
                        text: `*Question*\n${privateMeta.question}`
                    }
                },
                { // answer block
                    type: "section",
                    block_id: "answer_display",
                    text: {
                        type: "mrkdwn",
                        text: `*Answer*\n${privateMeta.answer}`
                    }
                },
                // actions: let user choose to post to channel
                {
                    type: "actions",
                    block_id: "post_actions",
                    elements: [
                        {
                            type: "button",
                            text: { type: "plain_text", text: "Reply in channel" },
                            action_id: "reply_in_channel",
                            value: "reply_in_channel"
                        }
                    ]
                }
            ]
        }
    });
});


/*
new_app.command('/retrieve', async ({ command, ack, say }) => {
    await ack()


    const question = command.text
    const info = await retrieveFile()
    const answer = await getChatResponse(info)


    // await say(`Your trying to retrieve: ${question}` + `\n \n answer: ${answer}`)
    await say(`Your question is: ${question}` + `\n \n answer: ` + `${answer}`)
})
*/


new_app.command('/help', async ({ command, ack, say }) => {
    await ack()

    await say(`"hello" - greets the user \n
        "chat" - ask ChatGPT a question \n
        "upload <event_key>" - upload Blue Alliance data for the specified event to OpenAI and create a vector store \n
        "help" - displays this help message`)
        
})


new_app.action('reply_in_channel', async ({ ack, body, client }) => {
    await ack();

    // read private_metadata from the view that contains the answer and channel
    let meta = null;
    try {
        meta = body.view && body.view.private_metadata ? JSON.parse(body.view.private_metadata) : null;
    } catch (e) {
        meta = null;
    }

    const channelId = meta && meta.channel_id ? meta.channel_id : null;
    const question = meta && meta.question ? meta.question : '';
    const answer = meta && meta.answer ? meta.answer : 'No answer available.';

    if (!channelId) {
        // update modal to indicate failure to find channel
        await client.views.update({
            view_id: body.view.id,
            view: {
                type: "modal",
                callback_id: "chat_modal",
                private_metadata: body.view.private_metadata,
                title: { type: "plain_text", text: "Chat" },
                close: { type: "plain_text", text: "Close" },
                blocks: [
                    { type: "section", text: { type: "mrkdwn", text: "*Unable to find the original channel to post the reply.*" } }
                ]
            }
        });
        return;
    }


    // post the answer into the original channel
    await client.chat.postMessage({
        channel: channelId,
        text: `*You asked:* ${question}\n\n*Answer:* ${answer}`
    });


    // update modal to show confirmation (cool emoji! or just a check mark)
    await client.views.update({
        view_id: body.view.id,
        view: {
            type: "modal",
            callback_id: "chat_modal",
            private_metadata: body.view.private_metadata,
            title: { type: "plain_text", text: "Chat" },
            close: { type: "plain_text", text: "Close" },
            blocks: [
                {
                    type: "section",
                    text: { type: "mrkdwn", text: `*Question*\n${question}` }
                },
                {
                    type: "section",
                    text: { type: "mrkdwn", text: `*Answer*\n${answer}` }
                },
                {
                    type: "section",
                    text: { type: "mrkdwn", text: `:white_check_mark: Answer posted to <#${channelId}>` }
                }
            ]
        }
    });
});





