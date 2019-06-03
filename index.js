require('dotenv').config();

const Discord = require('discord.js');
const client = new Discord.Client();

const COMMANDS = {
    // hotlink:
    // hoticon:
    // nohot: ,
    hot: maybeUpdateHotter,
};

const hotnessSettings = {
    enabled: false,
    icon: '🔥',

    words: 5,
    byUsers: 1,
    inMinutes: 2,
    coolAfterMinutes: 1,

    excludedChannels: [],
    hotChannels: {},
};

const coolingTimeouts = {};

function maybeUpdateHotter(message) {
    // W words, by X users, in Y minutes, remove icon after Z minutes
    const args = message.content.replace('.hot', '').trim().split(' ').map(parseFloat).filter(arg => arg != NaN);

    if (args.length === 0) {
        return toggleHotter();
    } else if (args.length === 4) {
        return updateHotter(args);
    } else {
        return help();
    }
}

function toggleHotter() {
    hotnessSettings.enabled = !hotnessSettings.enabled;
    return `hotter is now ${hotnessSettings.enabled ? 'enabled' : 'disabled'}!`;
}

function updateHotter(args) {
    const hs = hotnessSettings;
    hs.enabled = true;
    hs.words = args[0];
    hs.byUsers = args[1];
    hs.inMinutes = args[2];
    hs.coolAfterMinutes = args[3];

    return `hotness is now enabled! settings are: ${hs.words} words, by ${hs.byUsers} users, in ${hs.inMinutes} minutes. Remove icon after ${hs.coolAfterMinutes} minutes.`;
}

function help() {
    return 'help';
}

function timestampFromSnowflake(id) {
    return new Date((id / 4194304) + 1420070400000);
}

function checkHotness(message) {
    const cutoffTime = new Date(new Date() - hotnessSettings.inMinutes * 60000);
    const latestMessages = message.channel.messages.filter(msg => {
        const date = timestampFromSnowflake(msg.id);
        return date >= cutoffTime;
    });
    const numberOfWords = latestMessages.map(msg => msg.content).join(' ').split(' ').length;
    const numberOfUsers = new Set(latestMessages.map(msg => msg.author.id)).size;
    if (numberOfWords >= hotnessSettings.words && numberOfUsers >= hotnessSettings.byUsers) {
        setChannelHot(message);
    }
}

function channelIsHot(channel) {
    return !!hotnessSettings.hotChannels[channel.id];
}

function setChannelHot(message) {
    const channel = message.channel;
    const icon = hotnessSettings.icon;

    // Set name and send a message only if channel is not already hot.
    if (!channelIsHot(channel)) {
        channel.setName(icon + channel.name + icon);
        channel.send(hotnessSettings.icon + `This channel is HOT` + hotnessSettings.icon);
        hotnessSettings.hotChannels[channel.id] = channel;
    }

    // Set cooling timeout to remove icons after channel cools off.
    if (coolingTimeouts[channel.id]) {
        clearTimeout(coolingTimeouts[channel.id]);
    }
    coolingTimeouts[channel.id] = setTimeout(() => {
        channel.setName(channel.name.replace(icon, '').replace(icon, ''));
        hotnessSettings.hotChannels[channel.id] = undefined;
    }, hotnessSettings.coolAfterMinutes * 60 * 1000);

}

function dispatchCommand(message) {
    for (const cmd in COMMANDS) {
        if (message.content.startsWith('.' + cmd)) {
            return message.reply(COMMANDS[cmd](message));
        }
    }

    if (message.author.id !== client.user.id) {
        return checkHotness(message);
    }
}

client.on('ready', () => console.log(`Logged in as ${client.user.tag}!`));
client.on('message', dispatchCommand);
client.login(process.env.DISCORD_TOKEN);
