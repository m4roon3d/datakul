# One-time setup for automatic deploys

After this, every merge to `main` puts Datakul live by itself: the database, the AI gateway and the website. It takes about 20 minutes once, and everything stays on free plans.

You'll create two free accounts (Cloudflare and Groq), then paste four values into GitHub.

## 1. Cloudflare account

1. Sign up at **dash.cloudflare.com** (free plan).
2. In the left menu, open **Workers & Pages**. Opening it once gives your account its own `workers.dev` address, which the AI gateway needs. If it asks you to choose a subdomain, pick anything, for example your name.

## 2. Cloudflare account ID

1. Still in **Workers & Pages**, look at the right-hand side of the overview page for **Account ID**.
2. Copy it. This is value 1 of 4.

## 3. Cloudflare API token

This lets GitHub deploy for you. It can only touch Workers, D1 databases and Pages.

1. Click your profile icon (top right) → **My Profile** → **API Tokens** → **Create Token**.
2. Next to **Edit Cloudflare Workers**, click **Use template**.
3. Under **Permissions**, click **+ Add more** twice and add:
   - **Account** · **D1** · **Edit**
   - **Account** · **Cloudflare Pages** · **Edit**
4. Under **Account Resources**, choose **Include** · your account.
5. Under **Zone Resources**, choose **Include** · **All zones** (you have none yet; the template just asks).
6. Click **Continue to summary** → **Create Token**.
7. Copy the token straight away. Cloudflare shows it only once. This is value 2 of 4.

## 4. Groq API key

1. Sign up at **console.groq.com** (free).
2. Open **API Keys** → **Create API Key**, name it `datakul`, and copy it. This is value 3 of 4.

## 5. Review page password

Make up a long password (24 or more random characters; a password manager can generate one). It unlocks the community review page. This is value 4 of 4. Keep a copy somewhere safe; you'll type it on the review page.

## 6. Paste the four values into GitHub

1. Open **github.com/m4roon3d/datakul** → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret** four times, using exactly these names:

| Name | Value |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | the account ID from step 2 |
| `CLOUDFLARE_API_TOKEN` | the token from step 3 |
| `GROQ_API_KEY` | the key from step 4 |
| `ADMIN_TOKEN` | the password from step 5 |

Optional extra AI providers, as more secrets: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`.

## 7. First deploy

Open **Actions** → **Deploy** → **Run workflow**. In about three minutes the run's summary shows:

- the app's address (`https://datakul….pages.dev`),
- the review page (`…/admin.html`),
- the AI gateway's address and which AI providers answered.

From then on, every merge to `main` deploys automatically.

## Later

- **Your own domain:** add it to the Pages project in Cloudflare (Workers & Pages → datakul → Custom domains), then add a repository **variable** (not secret) named `EXTRA_ORIGINS` with its address, for example `https://datakul.in`, and run Deploy once.
- **Changing a key:** update the secret in GitHub, then run Deploy.
- **If a deploy fails:** the run shows a red error with what to fix (usually a missing token permission).
