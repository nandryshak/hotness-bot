require('dotenv').config();

const Discord = require('discord.js');
const client = new Discord.Client();
const fs = require('fs');

const COMMANDS = {
    // hoticon:
    hotlink: hotlink,
    hotenablehere: hotenablehere,
    hotdisablehere: hotdisablehere,
    hotsettings: hotsettings,
    hothelp: help,
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
    channelsToLink: new Set(),

    enabledUsers: [
        '189113793836482560', // soul
        '257314495876038656', // nanny
    ],

    generalChannelId: '263540094864982026',
};

const coolingTimeouts = {};

function parseArgs(message) {
    return message.content.trim().split(' ').slice(1);
}

function hotlink(message) {
    const args = parseArgs(message);
    if (hotnessSettings.channelsToLink.has(message.channel.id)) {
        hotnessSettings.channelsToLink.delete(message.channel.id);
        saveSettings();
        return `Channel will no longer be linked in #general`;
    } else {
        hotnessSettings.channelsToLink.add(message.channel.id);
        saveSettings();
        return `Channel will be linked in #general when it's hot`;
    }
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
    hotnessSettings.whitelist.add(message.channel.id);
    saveSettings();
    return `hotness is now enabled for this channel!`;
}

function hotdisablehere(message) {
    hotnessSettings.whitelist.delete(message.channel.id);
    saveSettings();
    return `hotness is now disabled for this channel`;
}

function hotsettings(message) {
    const settingsCopy = Object.assign({}, hotnessSettings);
    settingsCopy.whitelist = Array.from(settingsCopy.whitelist).map(cid => {
        const channel = client.channels.find(c => c.id === cid)
        return channel ? channel.name : '<unknown>';
    });
    settingsCopy.channelsToLink = Array.from(settingsCopy.channelsToLink).map(cid => {
        const channel = client.channels.find(c => c.id === cid)
        return channel ? channel.name : '<unknown>';
    })
    settingsCopy.hotChannels = Array.from(settingsCopy.hotChannels).map(c => c.hotName);
    const settingsJSON = JSON.stringify(settingsCopy, undefined, 4);
    return '```' + settingsJSON + '```';
}

function help() {
    return `Commands: \`\`\`
hotlink: toggle linking this channel in general when it becomes hot
hotenablehere: enable the hotness icons for this channel
hotdisablehere: disable the hotness icons for this channel
hotsettings: print settings
hot: toggle the hotness-bot
hot W X Y Z: change settings to: W words, by X users, in Y minutes, remove icon after Z minutes
\`\`\``;
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
        // channel.send(hotnessSettings.icon + `This channel is HOT` + hotnessSettings.icon);
        const hotChannel = { id: channel.id, hotName: hotName, oldName: oldName };
        console.log("hotChannel:", hotChannel);
        hotnessSettings.hotChannels.push(hotChannel);

        // Maybe put a link in the general channel
        if (hotnessSettings.channelsToLink.has(channel.id)) {
            const generalChannel = message.guild.channels.find(c => c.id === hotnessSettings.generalChannelId);
            if (generalChannel) {
                generalChannel.send(`Checkout the 🔥HOT🔥 discussion in <#${channel.id}>`);
            } else {
                console.error('Could not find general channel');
            }
        }

        saveSettings();
    }

    // Set cooling timeout to remove icons after channel cools off.
    if (coolingTimeouts[channel.id]) {
        clearTimeout(coolingTimeouts[channel.id]);
    }
    coolingTimeouts[channel.id] = setTimeout(() => {
        const hotChannel = hotnessSettings.hotChannels.find(c => c.id === channel.id);
        if (hotChannel && hotChannel.oldName) {
            console.log("cooling hotChannel:", hotChannel);
            const oldName = hotChannel.oldName;
            channel.setName(oldName);
            hotnessSettings.hotChannels = hotnessSettings.hotChannels.filter(c => c.id !== channel.id);
            saveSettings();
        }
    }, hotnessSettings.coolAfterMinutes * 60 * 1000);

}

function dispatchCommand(message) {
    if (hotnessSettings.enabledUsers.find(id => id === message.author.id)) {
        for (const cmd of COMMANDS) {
            if (message.content.match(`^\\.${cmd}\\b`)) {
                return message.reply(COMMANDS[cmd](message));
            }
        }
    }

    if (message.author.id !== client.user.id && hotnessSettings.enabled) {
        return checkHotness(message);
    }
}

function saveSettings() {
    const settingsCopy = Object.assign({}, hotnessSettings);
    settingsCopy.whitelist = Array.from(settingsCopy.whitelist);
    settingsCopy.channelsToLink = Array.from(settingsCopy.channelsToLink);
    const settingsJSON = JSON.stringify(settingsCopy, undefined, 4);
    fs.writeFile("settings.json", settingsJSON, err => err && console.log("Error saving settings:", err));
}

function loadSettings() {
    try {
        const settingsFileContents = fs.readFileSync('settings.json');
        const settingsJSON = JSON.parse(settingsFileContents);
        settingsJSON.whitelist = new Set(settingsJSON.whitelist);
        settingsJSON.channelsToLink = new Set(settingsJSON.channelsToLink);
        Object.assign(hotnessSettings, settingsJSON);
        for (const hotChannel of hotnessSettings.hotChannels) {
            client.channels.array().find(c => c.id === hotChannel.id).setName(hotChannel.oldName);;
        }
        hotnessSettings.hotChannels = [];
    } catch (e) {
        console.log("Error loading settings file. Using default settings.", e.message);
    }
    console.log("Settings:", hotnessSettings);
}

client.login(process.env.DISCORD_TOKEN);
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`)
    loadSettings();
});
client.on('message', dispatchCommand);
