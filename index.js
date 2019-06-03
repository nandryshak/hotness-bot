require('dotenv').config();

const Discord = require('discord.js');
const client = new Discord.Client();

const COMMANDS = {
    // hotlink:
    // hoticon:
    // nohot:
    hot: maybeUpdateHotter,
};

function maybeUpdateHotter(message) {
    // W words, by X users, in Y minutes, remove icon after Z minutes
    const args = message.content.replace('.hot', '').trim().split(' ').map(parseFloat).filter(arg => arg === NaN);
    console.log("args:", args);

    if (args.length === 0) {
        return toggleHotter();
    } else if (args.length === 4) {
        return updateHotter(args);
    } else {
        return help();
    }
}

function toggleHotter() {
    return 'toggleHotter'
}

function updateHotter(args) {
    return 'updateHotter'
}

function help() {
    return 'help'
}

function checkHotness(message) {
    console.log("checking hotness");
}

function dispatchCommand(message) {
    for (const cmd in COMMANDS) {
        if (message.content.startsWith('.' + cmd)) {
            return message.reply(COMMANDS[cmd](message));
        }
    }
    return checkHotness(message);
}

client.on('ready', () => console.log(`Logged in as ${client.user.tag}!`));
client.on('message', dispatchCommand);
client.login(process.env.DISCORD_TOKEN);
