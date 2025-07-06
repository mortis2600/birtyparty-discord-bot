require('dotenv').config();

const fs = require('fs');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const chrono = require('chrono-node');
const { DateTime } = require('luxon');

const birthdaysFile = './birthdays.json';
let birthdays = fs.existsSync(birthdaysFile)
  ? JSON.parse(fs.readFileSync(birthdaysFile))
  : {};

const settingsFile = './settings.json';
let settings = fs.existsSync(settingsFile)
  ? JSON.parse(fs.readFileSync(settingsFile))
  : {};

if (!settings.announcementTime) settings.announcementTime = '08:00';
if (!settings.announcementChannel) settings.announcementChannel = null;
if (!settings.timezone) settings.timezone = 'UTC';

let birthdayInterval = null;
let weeklyInterval = null;
let monthlyTimeout = null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  scheduleDailyBirthdayCheck();
  scheduleWeeklyPreview();
  scheduleMonthlyPreview();
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const [command, ...args] = message.content.trim().split(/ +/);
  const arg = args.join(' ');
  const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.ManageGuild);

// Auto-react to "happy birthday" or "happy anniversary" messages
const reactPhrases = [
  // birthday
  "happy birthday",
  "hbd",
  "🎂",
  "feliz cumpleaños",
  "joyeux anniversaire",
  "生日快乐",
  // anniversary
  "happy anniversary",
  "server anniversary",
  "join anniversary",
  "anniv",
  "congrats on your anniversary",
  "congratulations on your anniversary"
];

if (
  reactPhrases.some(phrase =>
    message.content.toLowerCase().includes(phrase)
  )
) {
  try {
    await message.react('🥳');
  } catch (e) {
    console.error('Failed to react:', e);
  }
}
  
  if (command === '!birthday') {
    const parsed = chrono.parseDate(arg);
    if (!parsed) return message.reply('please use a format like `YYYY-MM-DD`, `MM/DD/YYYY`, `sept 6th 1987`, or `9-6-77`');
    const year = parsed.getFullYear();
    const month = (parsed.getMonth() + 1).toString().padStart(2, '0');
    const day = parsed.getDate().toString().padStart(2, '0');
    const formatted = `${year}-${month}-${day}`;
    birthdays[message.author.id] = formatted;
    fs.writeFileSync(birthdaysFile, JSON.stringify(birthdays, null, 2));
    message.reply(`got it! your birthday is set to ${formatted}`);
  }

  if (command === '!mybirthday') {
    const saved = birthdays[message.author.id];
    if (saved) {
      message.reply(`your birthday is saved as ${saved}`);
    } else {
      message.reply(`i don’t have your birthday yet. try \`!birthday September 6, 1977\``);
    }
  }

  if (command === '!deletebirthday') {
    if (birthdays[message.author.id]) {
      delete birthdays[message.author.id];
      fs.writeFileSync(birthdaysFile, JSON.stringify(birthdays, null, 2));
      message.reply('your birthday has been removed.');
    } else {
      message.reply('you don’t have a birthday saved.');
    }
  }

  if (command === '!birthdays') {
    const entries = Object.entries(birthdays);
    if (entries.length === 0) return message.reply('no birthdays saved yet.');
    let chunks = [];
    let chunk = '🎂 saved birthdays:\n';
    for (const [id, date] of entries) {
      const line = `<@${id}> — ${date}\n`;
      if (chunk.length + line.length > 1900) {
        chunks.push(chunk);
        chunk = '';
      }
      chunk += line;
    }
    if (chunk) chunks.push(chunk);
    for (const part of chunks) {
      message.channel.send({ content: part, allowedMentions: { parse: [] } });
    }
  }

  if (command === '!nextbirthday') {
    const today = DateTime.now().setZone(settings.timezone);
    const currentYear = today.year;
    const sorted = Object.entries(birthdays)
      .map(([id, dateStr]) => {
        const [year, month, day] = dateStr.split('-').map(Number);
        let next = DateTime.fromObject({ year: currentYear, month, day }, { zone: settings.timezone });
        if (next < today) next = next.plus({ years: 1 });
        return { id, next };
      })
      .sort((a, b) => a.next - b.next);
    if (sorted.length === 0) return message.reply('no birthdays saved yet.');
    const nextUp = sorted[0];
    message.channel.send({
      content: `the next birthday is <@${nextUp.id}> on ${nextUp.next.toISODate()}`,
      allowedMentions: { parse: [] }
    });
  }

  if (command === '!birthdayconfig') {
    if (!isAdmin) return message.reply('you need the Manage Server permission to do that.');
    const sub = args.shift();
    const rest = args.join(' ');

    if (sub === 'time') {
      const match = rest.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
      if (!match) return message.reply('please provide time like `10:30am`, `22:45`, or `7 pm`');
      let [_, h, m = '00', meridian] = match;
      h = parseInt(h);
      m = parseInt(m);
      if (meridian?.toLowerCase() === 'pm' && h < 12) h += 12;
      if (meridian?.toLowerCase() === 'am' && h === 12) h = 0;
      if (h < 0 || h > 23 || m < 0 || m > 59) return message.reply('invalid time provided.');
      const formatted = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      settings.announcementTime = formatted;
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
      message.reply(`birthday announcements will now run at ${formatted}`);
      if (birthdayInterval) clearInterval(birthdayInterval);
      scheduleDailyBirthdayCheck();
    }

    if (sub === 'channel') {
      const match = rest.match(/^<#(\d+)>$/);
      if (!match) return message.reply('please tag a channel like `#birthdays`');
      settings.announcementChannel = match[1];
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
      message.reply(`birthday announcements will now post in <#${match[1]}>`);
    }

    if (sub === 'timezone') {
      try {
        DateTime.now().setZone(rest);
        settings.timezone = rest;
        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
        message.reply(`timezone set to ${rest}`);
      } catch {
        message.reply('invalid timezone. try something like `America/Chicago` or `UTC`');
      }
    }
  }

  // !anniversary: list user join anniversaries
  if (command === '!anniversary') {
  const guild = message.guild;
  if (!guild) return message.reply('can’t get guild info.');
  const member = await guild.members.fetch(message.author.id);
  if (!member) return message.reply('could not find you in the server.');
  if (member.user.bot) return message.reply('bots don’t get anniversaries!');
  const join = DateTime.fromJSDate(member.joinedAt).setZone(settings.timezone);
  const years = DateTime.now().setZone(settings.timezone).year - join.year;
  message.channel.send(
    `👋 you joined this server on ${join.toFormat('MMMM d, yyyy')} (${years} years ago)`
  );
}
  

  // !serveranniversary: show server creation date and age
  if (command === '!serveranniversary') {
    const guild = message.guild;
    if (!guild) return message.reply('can’t get guild info.');
    const created = DateTime.fromJSDate(guild.createdAt).setZone(settings.timezone);
    const years = DateTime.now().setZone(settings.timezone).year - created.year;
    message.channel.send(
      `🎂 this server was created on ${created.toFormat('MMMM d, yyyy')} (${years} years ago)`
    );
  }

  if (command === '!force') {
    if (!isAdmin) return message.reply('you need the Manage Server permission to do that.');
    const type = args[0];
    if (type === 'day') checkAndPostBirthdays();
    if (type === 'week') postWeeklyPreview();
    if (type === 'month') postMonthlyPreview();
  }

  if (command === '!birthdayhelp') {
    message.reply(`🎉 **Birthday Bot Commands**
for setting and managing birthdays on this server

👤 **user commands**:
\`!birthday <date>\` — save your birthday (formats like sept 6, 1987, 09/06/77, or 2000-01-01)
\`!mybirthday\` — view your saved birthday
\`!deletebirthday\` — remove your saved birthday
\`!birthdays\` — list all saved birthdays
\`!nextbirthday\` — see whose birthday is next
\`!anniversary\` — show all user join anniversaries
\`!serveranniversary\` — show the server’s creation date and age

⚙️ **admin commands**:
\`!birthdayconfig time <10:45am>\` — set daily announcement time
\`!birthdayconfig channel <#channel>\` — set announcement channel
\`!birthdayconfig timezone <Region/City>\` — set timezone
\`!force day|week|month\` — run today, weekly, or monthly birthday preview

🕐 bot automatically posts:
– daily birthdays at configured time
– weekly preview every monday
– monthly preview on the 1st`);
  }
});

function scheduleDailyBirthdayCheck() {
  const now = DateTime.now().setZone(settings.timezone);
  const [hour, minute] = (settings.announcementTime || '08:00').split(':').map(Number);
  let target = now.set({ hour, minute, second: 0, millisecond: 0 });
  if (target < now) target = target.plus({ days: 1 });
  const delay = target.toMillis() - now.toMillis();
  console.log(`Scheduled daily birthday check in ${Math.round(delay / 1000)}s at ${target.toISO()}`);
  setTimeout(() => {
    checkAndPostBirthdays();
    birthdayInterval = setInterval(checkAndPostBirthdays, 24 * 60 * 60 * 1000);
  }, delay);
}

function scheduleWeeklyPreview() {
  const now = DateTime.now().setZone(settings.timezone);
  const [hour, minute] = (settings.announcementTime || '08:00').split(':').map(Number);
  let next = now.set({ hour, minute, second: 0, millisecond: 0 }).plus({ days: (8 - now.weekday) % 7 });
  const delay = next.toMillis() - now.toMillis();
  console.log(`Scheduled weekly preview in ${Math.round(delay / 1000)}s at ${next.toISO()}`);
  setTimeout(() => {
    postWeeklyPreview();
    weeklyInterval = setInterval(postWeeklyPreview, 7 * 24 * 60 * 60 * 1000);
  }, delay);
}

function scheduleMonthlyPreview() {
  const now = DateTime.now().setZone(settings.timezone);
  const [hour, minute] = (settings.announcementTime || '08:00').split(':').map(Number);
  let next = DateTime.fromObject({ year: now.year, month: now.month + 1, day: 1, hour, minute }, { zone: settings.timezone });
  let delay = next.toMillis() - now.toMillis();
  if (delay > 2147483647) {
    console.log(`⚠️ delay for monthly preview too long (${delay}), capping and rechecking later`);
    delay = 24 * 60 * 60 * 1000; // recheck tomorrow
  }
  console.log(`Scheduled monthly preview in ${Math.round(delay / 1000)}s at ${next.toISO()}`);
  monthlyTimeout = setTimeout(() => {
    postMonthlyPreview();
    scheduleMonthlyPreview(); // reschedule
  }, delay);
}

async function checkAndPostBirthdays() {
  const today = DateTime.now().setZone(settings.timezone);
  const matches = Object.entries(birthdays).filter(([_, date]) => {
    const parsed = DateTime.fromISO(date, { zone: settings.timezone });
    return parsed.month === today.month && parsed.day === today.day;
  });
  const guild = client.guilds.cache.first();
  if (!guild || !settings.announcementChannel) return;
  const channel = guild.channels.cache.get(settings.announcementChannel);
  if (!channel || !channel.isTextBased()) return;
  for (const [id, date] of matches) {
    const birthYear = date.split('-')[0];
    const age = today.year - parseInt(birthYear);
    await channel.send(`🎉 happy birthday <@${id}>! 🎂 ${birthYear.length === 4 ? `(turning ${age})` : ''}`);
  }
}

async function postWeeklyPreview() {
  const today = DateTime.now().setZone(settings.timezone);
  const start = today;
  const end = today.plus({ days: 7 });
  const guild = client.guilds.cache.first();
  if (!guild || !settings.announcementChannel) return;
  const channel = guild.channels.cache.get(settings.announcementChannel);
  if (!channel || !channel.isTextBased()) return;

  let lines = ['📅 posting upcoming birthdays for the week...\n'];
  const members = await guild.members.fetch();

  // Birthdays
  for (const [id, date] of Object.entries(birthdays)) {
    const member = members.get(id);
    if (!member) continue;
    let [y, m, d] = date.split('-').map(Number);
    if (!m || !d) continue;
    const thisYear = DateTime.fromObject({ year: today.year, month: m, day: d }, { zone: settings.timezone });
    if (thisYear >= start && thisYear <= end) {
      const age = y && y > 1900 ? today.year - y : null;
      lines.push(`🎂 ${member.displayName} has a birthday on ${thisYear.toFormat('MMMM d')}${age ? ` (turning ${age})` : ''}`);
    }
  }

  // Join anniversaries
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const originalJoin = DateTime.fromJSDate(member.joinedAt).setZone(settings.timezone);
    const anniversary = DateTime.fromObject({
      year: today.year,
      month: originalJoin.month,
      day: originalJoin.day
    }, { zone: settings.timezone });
    if (anniversary >= start && anniversary <= end) {
      const years = today.year - originalJoin.year;
      lines.push(`👋 ${member.displayName} joined ${years} years ago on ${anniversary.toFormat('MMMM d')}`);
    }
  }

  if (lines.length === 1) lines.push('no upcoming birthdays or anniversaries!');
  await channel.send({ content: lines.join('\n'), allowedMentions: { parse: [] } });
}

async function postMonthlyPreview() {
  const today = DateTime.now().setZone(settings.timezone);
  const start = today.startOf('month');
  const end = today.endOf('month');
  const guild = client.guilds.cache.first();
  if (!guild || !settings.announcementChannel) return;
  const channel = guild.channels.cache.get(settings.announcementChannel);
  if (!channel || !channel.isTextBased()) return;

  let lines = ['📆 this month’s highlights:\n'];

  // Birthdays
  const members = await guild.members.fetch();
  for (const [id, date] of Object.entries(birthdays)) {
    const member = members.get(id);
    if (!member) continue;
    let [y, m, d] = date.split('-').map(Number);
    if (!m || !d) continue;
    const thisYear = DateTime.fromObject({ year: today.year, month: m, day: d }, { zone: settings.timezone });
    if (thisYear >= start && thisYear <= end) {
      const age = y && y > 1900 ? today.year - y : null;
      lines.push(`🎂 ${member.displayName} has a birthday on ${thisYear.toFormat('MMMM d')}${age ? ` (turning ${age})` : ''}`);
    }
  }

  // Join anniversaries
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const originalJoin = DateTime.fromJSDate(member.joinedAt).setZone(settings.timezone);
    const anniversary = DateTime.fromObject({
      year: today.year,
      month: originalJoin.month,
      day: originalJoin.day
    }, { zone: settings.timezone });
    if (anniversary >= start && anniversary <= end) {
      const years = today.year - originalJoin.year;
      lines.push(`👋 ${member.displayName} joined ${years} years ago on ${anniversary.toFormat('MMMM d')}`);
    }
  }

  if (lines.length === 1) lines.push('nothing on the calendar yet this month!');
  await channel.send({ content: lines.join('\n'), allowedMentions: { parse: [] } });
}

client.login(process.env.DISCORD_TOKEN);
