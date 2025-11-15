const{ App, SocketModeReceiver } = require('@slack/bolt')
require('dotenv').config()
const axios = require('axios')

const new_app = new App( {
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,

})

//Bot Commands
new_app.command('/hello', async ({ command, ack, say }) => {
	await ack()

	await say(`Hello <@${command.user_id}>`)
})

const API_URL = 'https://api.openai.com/v1/chat/completions' //defines URL your question goes to
const API_KEY = process.env.OPENAIKEY
const CHAT_INSTRUCTIONS = process.env.CHAT_INSTRUCTIONS || ""

async function getChatResponse(prompt) {
    try {
        //console.log("sending prompt to chatgpt") //debug log
        const messages = [];
        if(CHAT_INSTRUCTIONS !== undefined && CHAT_INSTRUCTIONS.length > 0) {
            messages.push({ role: "system", content: CHAT_INSTRUCTIONS }); 
            messages.push({ role: "user", content: prompt });
        }

        console.log(messages)

        const response = await axios.post(
            API_URL, //where axios sends the request
            {
                model: "gpt-3.5-turbo",
                messages: messages,
                max_tokens: 100, //limit response length
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


// "upload" function
const BLUE_FILE = process.env.BLUEALLIANCEFILE
// Retrieve file content API
const FILE_LINK = 'https://api.openai.com/v1/files/' + BLUE_FILE + '/content'

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

(async () => {
    //start your app
    await new_app.start(process.env.PORT || 3000)
    console.log('Bot app is running on port ${process.env.PORT || 3000}!' )
   // console.log()
}) () 


new_app.command('/chat', async ({ command, ack, /*say*/ client }) => {
    await ack()

    const question = command.text

     await client.views.open({
        trigger_id: command.trigger_id, //calls (triggers) the creation of a modal
        view: {
            type: "modal", 
            callback_id: "chat_modal",
            // pass the channel where the command was invoked so we can reply there
            private_metadata: JSON.stringify({ channel_id: command.channel_id, invoking_user: command.user_id }),
            title: {
                type: "plain_text",
                text: "Chat"
            },
            submit: { //submit button
                type: "plain_text",
                text: "Send"
            },
            blocks: [ //text input block
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
                        initial_value: question //fills block with the original command text
                    }
                }
            ]
        }
     })
    })
new_app.view('chat_modal', async ({ ack, body, view, client }) => {
    const userId = body.user.id;
    const prompt = view.state.values.user_prompt_block.user_prompt_input.value;

    // get answer from model
    const answer = await getChatResponse(prompt);

    // declaring the variable question
    const question = prompt;

    // prepare updated modal: show question (read-only) and the answer, plus a button to post to channel
    const privateMeta = {
        channel_id: (() => {
            try { return (view.private_metadata && JSON.parse(view.private_metadata).channel_id) || null } 
            catch(e){ return null }
        })(),
        question, answer
    };

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
                // question block
                {
                    type: "section",
                    block_id: "question_display",
                    text: {
                        type: "mrkdwn",
                        text: `*Question*\n${privateMeta.question}`
                    }
                },
                // answer block
                {
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


new_app.command('/retrieve', async ({ command, ack, say }) => {
    await ack()

    const question = command.text
    const info = await retrieveFile()
    const answer = await getChatResponse(info)

    // await say(`Your trying to retrieve: ${question}` + `\n \n answer: ${answer}`)
    await say(`Your question is: ${question}` + `\n \n answer: ` + `${answer}`)
})

new_app.command('/help', async ({ command, ack, say }) => {
	await ack()

	await say(`"hello" - greets the user \n 
        "chat" - ask ChatGPT a question \n 
        "retrieve" - get info from Blue Alliance file`)
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
