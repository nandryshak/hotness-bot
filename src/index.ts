require('events').EventEmitter.defaultMaxListeners = 100;
import * as Discord from 'discord.js';
// const Discord = require('discord.js');
const client = new Discord.Client();
require('dotenv').config();
import * as fs from 'fs';

const MOD_COMMANDS: Record<string, (message: Discord.Message) => string> = {
    // hoticon:
    hotlink: hotlink,
    hotenablehere: hotenablehere,
    hotdisablehere: hotdisablehere,
    hotsettings: hotsettings,
    hothelp: help,
    hot: maybeUpdateHotter,
    hotpingcooldown: hotpingcooldown,
    hotlistpingsignups: hotlistpingsignups,
    hotpingexclude: hotpingexclude,
    hotpinginclude: hotpinginclude,
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
    blacklist: Set<ChannelId>;
    hotChannels: Array<HotChannel>;
    channelsToLink: Set<ChannelId>;
    enabledRole: string;
    generalChannelId: ChannelId;
    hotSignups: Record<ChannelId, Set<UserId>>;
    hotSignupRoleId: string | undefined;
    hotSignupPings: Record<ChannelId, Discord.Message>;
    hotSignupPingCooldownMinutes: number;
    lastPingTimes: Record<ChannelId, Date>;
    hotPingExcludes: Set<ChannelId>;
}

const hotnessSettings: HotnessSettings = {
    enabled: false,
    icon: '🔥',
    words: 5,
    byUsers: 2,
    inMinutes: 3,
    coolAfterMinutes: 15,
    blacklist: new Set<ChannelId>(),
    hotChannels: new Array<HotChannel>(),
    channelsToLink: new Set<ChannelId>(),
    enabledRole: process.env.ENABLED_ROLE_ID || '269637424798236673', // 'Moderator' role id
    generalChannelId: '263540094864982026',
    hotSignups: {},
    hotSignupRoleId: process.env.HOT_SIGNUP_ROLE_ID,
    hotSignupPings: {},
    hotSignupPingCooldownMinutes: 15,
    lastPingTimes: {},
    hotPingExcludes: new Set<ChannelId>(),
};

const coolingTimeouts: Record<ChannelId, NodeJS.Timeout> = {};

function findChannel(maybeChannelName: string) {
    if (!maybeChannelName) {
        return undefined;
    }
    const channels: Discord.GuildChannel[] = client.guilds.array().map(g => g.channels.array()).reduce((acc, val) => acc.concat(val), []);
    let channel = channels.find(c => c.name.toLowerCase() === maybeChannelName);
    if (!channel) {
        channel = channels.find(c => c.name.toLowerCase().indexOf(maybeChannelName) !== -1);
    }
    return channel;
}

function hotpinginclude(message: Discord.Message) {
    const maybeChannelName = parseArgs(message).join(' ').toLowerCase();
    const channel = findChannel(maybeChannelName);
    if (!channel) {
        return `Error: could not find channel with name containing: '${maybeChannelName}'`;
    }
    hotnessSettings.hotPingExcludes.delete(channel.id);
    saveSettings();
    return `<#${channel.id}> is now eligible for hotness pings`;
}

function hotpingexclude(message: Discord.Message) {
    const maybeChannelName = parseArgs(message).join(' ').toLowerCase();
    const channel = findChannel(maybeChannelName);
    if (!channel) {
        return `Error: could not find channel with name containing: '${maybeChannelName}'`;
    }
    hotnessSettings.hotPingExcludes.add(channel.id);
    saveSettings();
    return `<#${channel.id}> is now excluded from hotness pings`;
}

function hotlistpingsignups(message: Discord.Message) {
    const maybeChannelName = parseArgs(message).join(' ').toLowerCase();
    const channel = findChannel(maybeChannelName);
    if (!channel) {
        return `Error: could not find channel with name containing: '${maybeChannelName}'`;
    }

    const userIds = hotnessSettings.hotSignups[channel.id] || new Set();
    const users = Array.from(userIds).map(uid => message.guild.members.get(uid));
    const names = users.map(user => {
        if (user) {
            return (user as Discord.GuildMember).displayName;
        } else {
            return '<unknown>';
        }
    });
    names.sort();

    return `${names.length} hotping signups in channel <#${channel.id}>:
\`\`\`
${names.join("\n")}
\`\`\``
}

function hotpingcooldown(message: Discord.Message) {
    const args = parseArgs(message).map(parseFloat).filter(arg => !!arg);
    const minutes = args[0];
    if (minutes) {
        hotnessSettings.hotSignupPingCooldownMinutes = minutes;
        saveSettings();
        return `hotping cooldown is now ${minutes} minutes.`;
    } else {
        return `Error updating hotping cooldown with minutes: ${minutes}`;
    }
}

function hotsignup(message: Discord.Message) {
    if (hotnessSettings.hotPingExcludes.has(message.channel.id)) {
        return;
    }
    if (!hotnessSettings.hotSignups[message.channel.id]) {
        hotnessSettings.hotSignups[message.channel.id] = new Set();
    }
    hotnessSettings.hotSignups[message.channel.id].add(message.member.id);
    saveSettings();
    message.reply(`You're now signed up for ${hotnessSettings.icon}HOTNESS${hotnessSettings.icon} in this channel!`).catch(console.error);
}

function hotsigndown(message: Discord.Message) {
    hotnessSettings.hotSignups[message.channel.id].delete(message.member.id);
    saveSettings();
    message.reply(`You are no longer signed up for hotness in this channel.`).catch(console.error);
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
    hotnessSettings.blacklist.delete(message.channel.id);
    saveSettings();
    return `hotness is now enabled for this channel!`;
}

function hotdisablehere(message: Discord.Message) {
    hotnessSettings.blacklist.add(message.channel.id);
    saveSettings();
    return `hotness is now disabled for this channel`;
}

function array_chunks<T>(array: Array<T>, chunk_size: number) {
    return Array(Math.ceil(array.length / chunk_size))
        .fill(undefined)
        .map((_: T, index: number) => index * chunk_size)
        .map((begin: number) => array.slice(begin, begin + chunk_size))
}

function hotsettings(message: Discord.Message) {
    const settingsCopy = <any>Object.assign({}, hotnessSettings);
    settingsCopy.blacklist = Array.from(settingsCopy.blacklist).map(cid => {
        const channel = <Discord.TextChannel>client.channels.find(c => c.id === cid)
        return channel ? channel.name : '<unknown>';
    });
    settingsCopy.channelsToLink = Array.from(settingsCopy.channelsToLink).map(cid => {
        const channel = <Discord.TextChannel>client.channels.find(c => c.id === cid)
        return channel ? channel.name : '<unknown>';
    })
    settingsCopy.hotPingExcludes = Array.from(settingsCopy.hotPingExcludes).map(cid => {
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
    settingsCopy.lastPingTimes = {};
    for (let channelId in hotnessSettings.lastPingTimes) {
        const channel = client.channels.find(c => c.id === channelId);
        if (channel) {
            const pingTime = hotnessSettings.lastPingTimes[channel.id];
            settingsCopy.lastPingTimes[(<Discord.TextChannel>channel).name] = pingTime ? `${pingTime.toLocaleString()} GMT` : '<unknown>';
        }
    }

    settingsCopy.hotSignupPings = undefined;
    try {
        const settingsJSON = JSON.stringify(settingsCopy, undefined, 4);
        if (settingsJSON.length <= 2000 - 6) {
            return '```' + settingsJSON + '```';
        } else {
            const chunks = array_chunks(Array.from(settingsJSON), 2000 - 100);
            chunks.forEach(chunk => message.reply(`\`\`\`${chunk.join('')}\`\`\``).catch(console.error));
            return '';
        }
    } catch (e) {
        console.error('Error in .hotsettings', e.message)
        return 'error building settingsJSON';
    }
}

function help() {
    return `
User Commands: \`\`\`
.hotsignup: add yourself to the HOTLIST for this channel. When the channel becomes hot, you'll be notified by a special ping.
.hotsigndown: remove yourself from the hotlist.
\`\`\`
Mod Commands: \`\`\`
.hotlink: toggle linking this channel in general when it becomes hot
.hotenablehere: enable the hotness icons for this channel
.hotdisablehere: disable the hotness icons for this channel
.hotsettings: print settings
.hot: toggle the hotness-bot
.hot W X Y Z: change settings to: W words, by X users, in Y minutes, remove icon after Z minutes
.hotpingcooldown N: set the cooldown of the hot ping to N number of minutes.
.hotlistpingsignups CHANNEL-NAME: list signups for the channel containing the string CHANNEL-NAME.
.hotpingexclude CHANNEL-NAME: exclude channel from hot pings by adding it to the blacklist.
.hotpinginclude CHANNEL-NAME: remove channel from the hot ping blacklist.
\`\`\``;
}

function timestampFromSnowflake(id: Discord.Snowflake) {
    return new Date((parseFloat(id) / 4194304) + 1420070400000);
}

function checkHotness(message: Discord.Message) {
    const cutoffTime = new Date(<any>new Date() - hotnessSettings.inMinutes * 60000);
    const latestMessages = message.channel.messages.filter(msg => {
        const date = timestampFromSnowflake(msg.id);
        return date >= cutoffTime && !msg.author.bot;
    });
    const numberOfWords = latestMessages.map(msg => msg.content).join(' ').split(' ').length;
    const numberOfUsers = new Set(latestMessages.map(msg => msg.author.id)).size;
    const channelInBlacklist = hotnessSettings.blacklist.has(message.channel.id);
    const channelIsHot = numberOfWords >= hotnessSettings.words && numberOfUsers >= hotnessSettings.byUsers && !channelInBlacklist;
    const forceHotness = message.member.roles.has(hotnessSettings.enabledRole) && message.content === '.forcehotness';
    if (channelIsHot || forceHotness) {
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
        console.log("hotChannel:", hotChannel.hotName, 'oldName:', oldName);
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
        console.log("cooling hotChannel:", hotChannel.hotName, 'oldName:', hotChannel.oldName);
        const oldName = hotChannel.oldName;
        channel.setName(oldName);
        hotnessSettings.hotChannels = hotnessSettings.hotChannels.filter(c => c.id !== channel.id);
        deleteHotSignupPing(channel.id);
        saveSettings();
    }
}

function deleteHotSignupPing(channelId: ChannelId) {
    const message = hotnessSettings.hotSignupPings[channelId];
    if (message) {
        message.delete().catch(() => {
            console.error('couldn\'t delete message:', message.id);
        });
    }
}

function removeRoles(users: Discord.GuildMember[], role: Discord.Role) {
    return users.map(user => user ? user.removeRole(role) : Promise.resolve());
}

function pingHotSignups(channel: Discord.TextChannel) {
    if (channel.id === hotnessSettings.generalChannelId) return;
    
    if (!hotnessSettings.hotSignupRoleId) {
        console.error('No hotSignupRoleId!', hotnessSettings.hotSignupRoleId);
        return;
    }

    const lastPing = hotnessSettings.lastPingTimes[channel.id] || new Date(1970);
    const minutesSinceLastPing = (new Date().getTime() - lastPing.getTime()) / 1000 / 60;
    if (minutesSinceLastPing < hotnessSettings.hotSignupPingCooldownMinutes) {
        // If the last ping was less than `hotSignupPingCooldownMinutes` minutes ago, return and don't ping again.
        return;
    } else {
        // Else, update the last ping time to now and carry on.
        hotnessSettings.lastPingTimes[channel.id] = new Date();
    }

    const role = channel.guild.roles.get(hotnessSettings.hotSignupRoleId) as Discord.Role;
    const userIds = (hotnessSettings.hotSignups[channel.id] || new Set());
    // Just return if there's nobody to ping.
    if (userIds.size === 0) return;

    // Remove all the ping roles from the members of the channel first to make sure nobody gets pinged incorrectly.
    Promise.all(<any>removeRoles(channel.members.array(), role)).then(() => {
        let count = 0;
        // Add the role to everybody in the signup list and count them.
        Promise.all(<any>Array.from(userIds).map(userId => {
            const user = channel.members.array().find(member => member.id === userId);
            if (user) {
                count += 1;
                return user.addRole(role);
            } else {
                return Promise.resolve();
            }
        })).then(() => {
            console.log(`pinging ${count} out of ${userIds.size} users in ${channel.name}`)
            // Ping them, then remove the role from them all.
            channel.send(`<@&${role.id}> ${channel.name} is HOT!`)
                .then(message => {
                    hotnessSettings.hotSignupPings[channel.id] = message as Discord.Message;
                    const TIMEOUT = 5000;
                    setTimeout(() => {
                        removeRoles(Array.from(userIds).map(uid => channel.members.get(uid) as Discord.GuildMember), role);
                    }, TIMEOUT);
                })
                .catch(console.error);
        }).catch(e => {
            console.error('Error while adding roles:');
            console.error(e);
        });
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
                const response = MOD_COMMANDS[cmd](message);
                if (response) {
                    return message.reply(response).catch(console.error);
                }
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
    const settingsCopy = <any>{};

    settingsCopy.enabled = hotnessSettings.enabled;
    settingsCopy.icon = hotnessSettings.icon;

    settingsCopy.words = hotnessSettings.words;
    settingsCopy.byUsers = hotnessSettings.byUsers;
    settingsCopy.inMinutes = hotnessSettings.inMinutes;
    settingsCopy.coolAfterMinutes = hotnessSettings.coolAfterMinutes;
    settingsCopy.hotChannels = hotnessSettings.hotChannels;
    settingsCopy.blacklist = Array.from(hotnessSettings.blacklist);
    settingsCopy.channelsToLink = Array.from(hotnessSettings.channelsToLink);
    settingsCopy.hotPingExcludes = Array.from(hotnessSettings.hotPingExcludes);

    settingsCopy.hotSignups = {};
    for (let channelId in hotnessSettings.hotSignups) {
        settingsCopy.hotSignups[channelId] = Array.from(hotnessSettings.hotSignups[channelId] || new Set());
    }

    settingsCopy.hotSignupPingCooldownMinutes = hotnessSettings.hotSignupPingCooldownMinutes;
    settingsCopy.lastPingTimes = hotnessSettings.lastPingTimes;

    const settingsJSON = JSON.stringify(settingsCopy, undefined, 4);
    fs.writeFile("settings.json", settingsJSON, err => err && console.error("Error saving settings:", err));
}

function loadSettings() {
    try {
        const settingsFileContents = fs.readFileSync('settings.json');
        const settingsJSON = JSON.parse(settingsFileContents.toString());
        settingsJSON.blacklist = new Set(settingsJSON.blacklist);
        settingsJSON.channelsToLink = new Set(settingsJSON.channelsToLink);
        settingsJSON.hotPingExcludes = new Set(settingsJSON.hotPingExcludes);
        for (let channelId in settingsJSON.hotSignups) {
            settingsJSON.hotSignups[channelId] = new Set(settingsJSON.hotSignups[channelId]);
        }
        Object.assign(hotnessSettings, settingsJSON);
        for (const hotChannel of hotnessSettings.hotChannels) {
            (<Discord.TextChannel>client.channels.array().find(c => c.id === hotChannel.id)).setName(hotChannel.oldName);;
        }
        hotnessSettings.hotChannels = [];
        hotnessSettings.hotSignupPingCooldownMinutes = settingsJSON.hotSignupPingCooldownMinutes || 15;
        for (const channelId in settingsJSON.lastPingTimes) {
            hotnessSettings.lastPingTimes[channelId] = new Date(settingsJSON.lastPingTimes[channelId]);
        }
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
