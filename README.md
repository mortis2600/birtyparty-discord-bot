# Birthday Bot

A Discord bot for managing birthday and anniversary announcements with reactions and helpful commands.

## commands

`!birthdayconfig time <HH:MM(am/pm)>` - set daily announcement time  
`!birthdayconfig channel <#channel>` - set announcement channel  
`!birthdayconfig timezone <Region/City>` - set timezone for announcements  
`!force day|week|month` - force immediate birthday/anniversary announcement or preview  
`!birthdayhelp` - shows this help message  

## installation

1. clone this repo  
2. run `npm install` to install dependencies  
3. create a `.env` file in the project root with your discord bot token:  

DISCORD_TOKEN=your_bot_token_here

4. run the bot with `node index.js`  
5. invite the bot to your server with the proper permissions (read/send messages, react, manage messages)  

## updating the bot

to update the bot:

- pull latest changes from the repo  
- run `npm install` again if dependencies changed  
- restart the bot process  

if you made local changes, commit them first to avoid losing work.
