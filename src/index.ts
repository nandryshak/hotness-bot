require('dotenv').config();

// const Discord = require('discord.js');
import * as Discord from 'discord.js';
const client = new Discord.Client();
import * as fs from 'fs';

const MOD_COMMANDS: Record<string, (message: Discord.Message) => string> = {
    // hoticon:
    hotlink: hotlink,
    hotenablehere: hotenablehere,
    hotdisablehere: hotdisablehere,
    hotsettings: hotsettings,
    hothelp: help,
    hot: maybeUpdateHotter,
};

const USER_COMMANDS: Record<string, (message: Discord.Message) => void> = {
    hotsignup: hotsignup,
    hotsigndown: hotsigndown,
}

type ChannelId = Discord.Snowflake;
type UserId = Discord.Snowflake;
interface HotChannel {
    id: ChannelId,
    hotName: string,
    oldName: string,
};
interface HotnessSettings {
    enabled: boolean;
    icon: string;
    words: number;
    byUsers: number;
    inMinutes: number;
    coolAfterMinutes: number;
    whitelist: Set<ChannelId>;
    hotChannels: Array<HotChannel>;
    channelsToLink: Set<ChannelId>;
    enabledRole: string;
    generalChannelId: ChannelId;
    hotSignups: Record<ChannelId, Set<UserId>>;
    hotSignupRoleId: string | undefined;
    hotSignupPings: Record<ChannelId, Discord.Message>;
}

const hotnessSettings: HotnessSettings = {
    enabled: false,
    icon: '🔥',
    words: 5,
    byUsers: 2,
    inMinutes: 3,
    coolAfterMinutes: 15,
    whitelist: new Set<ChannelId>(),
    hotChannels: new Array<HotChannel>(),
    channelsToLink: new Set<ChannelId>(),
    enabledRole: process.env.ENABLED_ROLE_ID || '269637424798236673', // 'Moderator' role id
    generalChannelId: '263540094864982026',
    hotSignups: {},
    hotSignupRoleId: process.env.HOT_SIGNUP_ROLE_ID,
    hotSignupPings: {},
};

const coolingTimeouts: Record<ChannelId, NodeJS.Timeout> = {};

function selfDestructIn(message: Discord.Message, timeoutms: number) {
    setTimeout(() => {
        message.delete().catch(console.error);
    }, timeoutms)
}

function hotsignup(message: Discord.Message) {
    if (!hotnessSettings.hotSignups[message.channel.id]) {
        hotnessSettings.hotSignups[message.channel.id] = new Set();
    }
    hotnessSettings.hotSignups[message.channel.id].add(message.member.id);
    saveSettings();
    message.reply(`You're now signed up for ${hotnessSettings.icon}HOTNESS${hotnessSettings.icon} in this channel!`)
        .then(sentMessage => {
            selfDestructIn(message, 2000);
            selfDestructIn(<Discord.Message>sentMessage, 2000);
        });
}

function hotsigndown(message: Discord.Message) {
    hotnessSettings.hotSignups[message.channel.id].delete(message.member.id);
    saveSettings();
    message.reply(`You are no longer signed up for hotness in this channel.`)
        .then(sentMessage => {
            selfDestructIn(message, 2000);
            selfDestructIn(<Discord.Message>sentMessage, 2000);
        });
}

type Args = string[];
function parseArgs(message: Discord.Message): Args {
    return message.content.trim().split(' ').slice(1);
}

function hotlink(message: Discord.Message) {
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

function maybeUpdateHotter(message: Discord.Message) {
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

function updateHotter(args: number[]) {
    const hs = hotnessSettings;
    hs.enabled = true;
    hs.words = args[0];
    hs.byUsers = args[1];
    hs.inMinutes = args[2];
    hs.coolAfterMinutes = args[3];
    saveSettings();
    return `hotness is now enabled! settings are: ${hs.words} words, by ${hs.byUsers} users, in ${hs.inMinutes} minutes. Remove icon after ${hs.coolAfterMinutes} minutes.`;
}

function hotenablehere(message: Discord.Message) {
    hotnessSettings.whitelist.add(message.channel.id);
    saveSettings();
    return `hotness is now enabled for this channel!`;
}

function hotdisablehere(message: Discord.Message) {
    hotnessSettings.whitelist.delete(message.channel.id);
    saveSettings();
    return `hotness is now disabled for this channel`;
}

function hotsettings() {
    const settingsCopy = <any>Object.assign({}, hotnessSettings);
    settingsCopy.whitelist = Array.from(settingsCopy.whitelist).map(cid => {
        const channel = <Discord.TextChannel>client.channels.find(c => c.id === cid)
        return channel ? channel.name : '<unknown>';
    });
    settingsCopy.channelsToLink = Array.from(settingsCopy.channelsToLink).map(cid => {
        const channel = <Discord.TextChannel>client.channels.find(c => c.id === cid)
        return channel ? channel.name : '<unknown>';
    })
    settingsCopy.hotChannels = settingsCopy.hotChannels.map((c: HotChannel) => c.hotName);

    settingsCopy.hotSignups = {};
    for (let channelId in hotnessSettings.hotSignups) {
        const channel = client.channels.find(c => c.id === channelId);
        const signups = (hotnessSettings.hotSignups[channelId] || new Set()).size;
        if (channel) {
            settingsCopy.hotSignups[(<Discord.TextChannel>channel).name] = signups;
        }
    }

    settingsCopy.hotSignupPings = undefined;
    try {
        const settingsJSON = JSON.stringify(settingsCopy, undefined, 4);
        return '```' + settingsJSON + '```';
    } catch (e) {
        console.error('Error in .hotsettings', e.message)
        return 'error building settingsJSON';
    }
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

function timestampFromSnowflake(id: Discord.Snowflake) {
    return new Date((parseFloat(id) / 4194304) + 1420070400000);
}

function checkHotness(message: Discord.Message) {
    const cutoffTime = new Date(<any>new Date() - hotnessSettings.inMinutes * 60000);
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

function channelIsHot(channel: Discord.GuildChannel) {
    return !!hotnessSettings.hotChannels.find(c => c.id == channel.id);
}

function setChannelHot(message: Discord.Message) {
    const channel = <Discord.TextChannel>message.channel;
    const icon = hotnessSettings.icon;

    // Set name and send a message only if channel is not already hot.
    if (!channelIsHot(channel)) {
        const oldName = channel.name.replace(new RegExp(hotnessSettings.icon, 'g'), '');
        const hotName = icon + oldName + icon;
        channel.setName(hotName);
        // channel.send(hotnessSettings.icon + `This channel is HOT` + hotnessSettings.icon);
        const hotChannel = { id: channel.id, hotName: hotName, oldName: oldName };
        console.log("hotChannel:", hotChannel);
        hotnessSettings.hotChannels.push(hotChannel);

        // Maybe put a link in the general channel
        if (hotnessSettings.channelsToLink.has(channel.id)) {
            const generalChannel = <Discord.TextChannel>message.guild.channels.find(c => c.id === hotnessSettings.generalChannelId);
            if (generalChannel) {
                generalChannel.send(`Checkout the 🔥HOT🔥 discussion in <#${channel.id}>`);
            } else {
                console.error('Could not find general channel');
            }
        }

        pingHotSignups(channel);

        saveSettings();
    }

    // Set cooling timeout to remove icons after channel cools off.
    if (coolingTimeouts[channel.id]) {
        clearTimeout(coolingTimeouts[channel.id]);
    }
    coolingTimeouts[channel.id] = setTimeout(() => coolChannel(channel), hotnessSettings.coolAfterMinutes * 60 * 1000);

}

function coolChannel(channel: Discord.TextChannel) {
    const hotChannel = hotnessSettings.hotChannels.find(c => c.id === channel.id);
    if (hotChannel && hotChannel.oldName) {
        console.log("cooling hotChannel:", hotChannel);
        const oldName = hotChannel.oldName;
        channel.setName(oldName);
        hotnessSettings.hotChannels = hotnessSettings.hotChannels.filter(c => c.id !== channel.id);
        deleteHotSignupPing(channel.id);
        saveSettings();
    }
}

function deleteHotSignupPing(channelId: ChannelId) {
    const message = hotnessSettings.hotSignupPings[channelId];
    if (message) message.delete().catch();
}

function pingHotSignups(channel: Discord.TextChannel) {
    if (!hotnessSettings.hotSignupRoleId) {
        console.error('No hotSignupRoleId!', hotnessSettings.hotSignupRoleId);
        return;
    }

    const role = channel.guild.roles.get(hotnessSettings.hotSignupRoleId) as Discord.Role;
    const userIds = (hotnessSettings.hotSignups[channel.id] || new Set());
    if (userIds.size === 0) return;

    userIds.forEach(userId => {
        const user = channel.members.array().find(member => member.id === userId);
        if (user) {
            user.addRole(role);
        }
    });

    channel.send(`<@&${role.id}> ${channel.name} is HOT!`)
        .then(message => {
            hotnessSettings.hotSignupPings[channel.id] = message as Discord.Message;
            const TIMEOUT = 5000;
            setTimeout(() => {
                userIds.forEach(userId => {
                    const user = channel.members.get(userId) as Discord.GuildMember;
                    user.removeRole(role);
                });
            }, TIMEOUT);
        });
}

function isNanny(id: string) {
    return id === '257314495876038656';
}

function dispatchCommand(message: Discord.Message) {
    if (!message.member) return;

    if (message.member.roles.has(hotnessSettings.enabledRole) || isNanny(message.member.id)) {
        for (const cmd in MOD_COMMANDS) {
            if (message.content.match(`^\\.${cmd}\\b`)) {
                return message.reply(MOD_COMMANDS[cmd](message));
            }
        }
    }

    for (const cmd in USER_COMMANDS) {
        if (message.content.match(`^\\.${cmd}\\b`)) {
            return USER_COMMANDS[cmd](message);
        }
    }

    if (message.author.id !== client.user.id && hotnessSettings.enabled) {
        return checkHotness(message);
    }
}

function saveSettings() {
    const settingsCopy = <any>Object.assign({}, hotnessSettings);
    settingsCopy.whitelist = Array.from(settingsCopy.whitelist);
    settingsCopy.channelsToLink = Array.from(settingsCopy.channelsToLink);
    settingsCopy.hotSignups = {};
    for (let channelId in hotnessSettings.hotSignups) {
        settingsCopy.hotSignups[channelId] = Array.from(hotnessSettings.hotSignups[channelId] || new Set());
    }
    settingsCopy.hotSignupPings = undefined;
    const settingsJSON = JSON.stringify(settingsCopy, undefined, 4);
    fs.writeFile("settings.json", settingsJSON, err => err && console.error("Error saving settings:", err));
}

function loadSettings() {
    try {
        const settingsFileContents = fs.readFileSync('settings.json');
        const settingsJSON = JSON.parse(settingsFileContents.toString());
        settingsJSON.whitelist = new Set(settingsJSON.whitelist);
        settingsJSON.channelsToLink = new Set(settingsJSON.channelsToLink);
        for (let channelId in settingsJSON.hotSignups) {
            settingsJSON.hotSignups[channelId] = new Set(settingsJSON.hotSignups[channelId]);
        }
        Object.assign(hotnessSettings, settingsJSON);
        for (const hotChannel of hotnessSettings.hotChannels) {
            (<Discord.TextChannel>client.channels.array().find(c => c.id === hotChannel.id)).setName(hotChannel.oldName);;
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
