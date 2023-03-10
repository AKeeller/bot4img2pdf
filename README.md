# bot4img2pdf

## Introduction

This Telegram bot accepts images from the user and losslessly concatenates them in a single PDF that is sent to the user.\
[@img2pdf4bot](https://t.me/img2pdf4bot) is currently live and can be tried by anyone.

### Usage

1. Open a conversation with [@img2pdf4bot](https://t.me/img2pdf4bot).

2. Send `/start`.

3. Send some photos.

4. Send `/done`.

5. Repeat from step 3.

## Requirements

* [Node.js](https://nodejs.org) [mandatory]
* [`img2pdf`](https://pypi.org/project/img2pdf/) [mandatory]

## Download, setup and run the project

1. Create a Telegram bot using [BotFather](https://t.me/BotFather).

2. Download the project running `git clone 'https://github.com/AKeeller/bot4img2pdf.git'`.

3. `cd` into the root folder of the project and run `npm install`.

4. Create a file called `.env` and populate it as described in the [Env variables](#env-variables) section.

5. Run the bot with `npm start` or `tsc && node -r dotenv/config dist/index.js`.

## Documentation

### Env variables

Variable name | Type   | Default | Mandatory | Description
--------------|--------|---------|-----------|-----------------------------------------------------------------
`TOKEN`       | string | `NULL`  | true      | It represents your bot token.
`WEBHOOK_URL` | string | `NULL`  | false     | HTTPS URL to send updates to. E.g.: `https://example.com:8443`.
`CERT`        | path   | `NULL`  | false     | If you need a custom certificate for your webhook, set its path.
`KEY`         | path   | `NULL`  | false     | If you need a custom key for your webhook, set its path.

#### How to set env variables during development

1. Create a file called `.env` on the root folder of the project.

2. Inside it, write a list of env variables. For example:

    ```dotenv
    TOKEN='123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11'
    ```

3. Run with `node -r dotenv/config dist/index.js`.

## Docker

It's possible to run [@img2pdf4bot](https://t.me/img2pdf4bot) as a Docker container.

### Docker CLI

```sh
docker run -d --name bot4img2pdf --restart unless-stopped -p 8443:8443 --env TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11 --env WEBHOOK_URL=https://telegram.example.com:8443 --env CERT=/certificate/public.pem --env KEY=/certificate/private.key -v /path/to/certificate:/certificate ghcr.io/akeeller/bot4img2pdf
```

### Docker Compose

```yaml
services:
  bot4img2pdf:
    image: ghcr.io/akeeller/bot4img2pdf
    container_name: bot4img2pdf
    restart: unless-stopped
    ports:
      - 8443:8443
    environment:
      TOKEN: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
      WEBHOOK_URL: https://telegram.example.com:8443 # Optional
      CERT: /certificate/public.pem ## Optional
      KEY: /certificate/private.key ## Optional
    volumes:
      - /path/to/certificate:/certificate # Optional
```
