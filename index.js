require('dotenv').config();

const Discord = require('discord.js');
const client = new Discord.Client();

const COMMANDS = {
    // hotlink:
    // hoticon:
    // nohot: ,
    hotenablehere: hotenablehere,
    hotsettings: hotsettings,
    hot: maybeUpdateHotter,
};

const hotnessSettings = {
    enabled: false,
    icon: '🔥',

    words: 5,
    byUsers: 2,
    inMinutes: 3,
    coolAfterMinutes: 15,

    whitelist: new Set(),
    hotChannels: [],
};

const coolingTimeouts = {};

function saveSettings() {

}

function parseArgs(message) {
    return message.content.trim().split(' ').slice(1);
}

function noArgs(args) {
    return args.length === 0;
}

function maybeUpdateHotter(message) {
    // W words, by X users, in Y minutes, remove icon after Z minutes
    const args = parseArgs(message).map(parseFloat).filter(arg => !!arg);

    if (args.length === 0) {
        return toggleHotter();
    } else if (args.length === 4) {
        return updateHotter(args);
    } else {
        return help();
    }
}

function toggleHotter() {
    const hs = hotnessSettings;
    hs.enabled = !hs.enabled;
    let str = `hotter is now ${hs.enabled ? 'enabled' : 'disabled'}!`;
    if (hs.enabled) {
        str += ` settings are: ${hs.words} words, by ${hs.byUsers} users, in ${hs.inMinutes} minutes. Remove icon after ${hs.coolAfterMinutes} minutes.`;
    }
    return str;
}

function updateHotter(args) {
    const hs = hotnessSettings;
    hs.enabled = true;
    hs.words = args[0];
    hs.byUsers = args[1];
    hs.inMinutes = args[2];
    hs.coolAfterMinutes = args[3];
    saveSettings();
    return `hotness is now enabled! settings are: ${hs.words} words, by ${hs.byUsers} users, in ${hs.inMinutes} minutes. Remove icon after ${hs.coolAfterMinutes} minutes.`;
}

function hotenablehere(message) {
    const args = parseArgs(message);
    if (noArgs(args)) {
        hotnessSettings.whitelist.add(message.channel.id);
        saveSettings();
        return `hotness is now enabled for this channel!`;
    } else {
        return help();
    }
}

function hotsettings(message) {
    const settingsCopy = Object.assign({}, hotnessSettings);
    settingsCopy.whitelist = Array.from(settingsCopy.whitelist).map(cid => message.guild.channels.find(c => c.id === cid).name)
    settingsCopy.hotChannels = Array.from(settingsCopy.hotChannels).map(c => c.hotName);
    const settingsJSON = JSON.stringify(settingsCopy, undefined, 4);
    return '```' + settingsJSON + '```';
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
    const channelInWhitelist = hotnessSettings.whitelist.has(message.channel.id);
    if (numberOfWords >= hotnessSettings.words && numberOfUsers >= hotnessSettings.byUsers && channelInWhitelist) {
        setChannelHot(message);
    }
}

function channelIsHot(channel) {
    return !!hotnessSettings.hotChannels.find(c => c.id == channel.id);
}

function setChannelHot(message) {
    const channel = message.channel;
    const icon = hotnessSettings.icon;

    // Set name and send a message only if channel is not already hot.
    if (!channelIsHot(channel)) {
        const oldName = channel.name;
        const hotName = icon + oldName + icon;
        channel.setName(hotName);
        channel.send(hotnessSettings.icon + `This channel is HOT` + hotnessSettings.icon);
        const hotChannel = { id: channel.id, hotName: hotName, oldName: oldName };
        console.log("hotChannel:", hotChannel);
        hotnessSettings.hotChannels.push(hotChannel);
    }

    // Set cooling timeout to remove icons after channel cools off.
    if (coolingTimeouts[channel.id]) {
        clearTimeout(coolingTimeouts[channel.id]);
    }
    coolingTimeouts[channel.id] = setTimeout(() => {
        const hotChannel = hotnessSettings.hotChannels.find(c => c.id === channel.id);
        console.log("cooling hotChannel:", hotChannel);
        const oldName = hotChannel.oldName;
        if (oldName) {
            channel.setName(oldName);
            hotnessSettings.hotChannels = hotnessSettings.hotChannels.filter(c => c.id !== channel.id);
        }
    }, hotnessSettings.coolAfterMinutes * 60 * 1000);

}

function dispatchCommand(message) {
    for (const cmd in COMMANDS) {
        if (message.content.match(`^\\.${cmd}\\b`)) {
            return message.reply(COMMANDS[cmd](message));
        }
    }

    if (message.author.id !== client.user.id && hotnessSettings.enabled) {
        return checkHotness(message);
    }
}

client.on('ready', () => console.log(`Logged in as ${client.user.tag}!`));
client.on('message', dispatchCommand);
client.login(process.env.DISCORD_TOKEN);
