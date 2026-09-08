# 🏈 Fantasy Football Projection Lab & Intelligence Suite

An advanced, algorithmic Fantasy Football projection workbench and analytics engine for ESPN fantasy leagues. It blends ESPN baseline projections with live Kalshi prediction markets, match-up difficulty factors, pace modifiers, game script simulations, Bayesian shrinkage, and automated post-week machine learning adjustments.

---

## ✨ Features

- **Dynamic Analytical Projection Engine**:
  - Full granular control over projection adjustments (Matchup ratings, Pace, Injury risk, Expected TD scaling, Bayesian regression toward the mean).
  - Instant live zero-delta toggle to compare directly against raw ESPN projections.
  - Per-player mathematical breakdown modal detailing every multiplier applied.
- **Kalshi Prediction Market Wisdom**:
  - Live crowdsourced market probability integration for passing, rushing, and receiving player props.
  - Real-time market signal badges on matchup cards and roster views.
- **Start / Sit & Matchup Roster Advisor**:
  - Automatically identifies optimal starters, bench edges, and lineup mistakes before kickoff.
- **Waiver Wire & Free Agent Target Advisor**:
  - Evaluates roster weaknesses by position and scores top available free agents using projected delta, Sleeper add/drop trending velocity, and upcoming schedule favorability.
- **Post-Week Learning & Backtesting Engine**:
  - Compares projected vs. actual performance across weeks.
  - Generates recommended factor calibration adjustments to improve future accuracy.
- **Google Gemini AI Scout & Bench Coach (Free Tier)**:
  - In-app AI configuration popup to connect your free Google AI Studio key (`AIzaSy...`) in 30 seconds.
  - On-demand player scouting intelligence reports explaining model deltas, Kalshi signals, and start/sit verdicts.
  - Interactive "Ask AI Scout" chat drawer for real-time matchup strategy, roster advice, and waiver recommendations.
- **In-App League Connection Wizard**:
  - Seamlessly input and validate your ESPN League ID, Season, `SWID`, and `espn_s2` directly inside the web UI without manual file editing.
- **Docker Ready**:
  - Production-ready Docker container and Compose configuration with persistent volumes for config, formula parameters, and learning history.

---

## 🚀 Quick Start with Docker

The easiest way to deploy and run the Fantasy Projection Lab is using Docker Compose.

### 1. Clone the repository
```bash
git clone https://github.com/jorgescomx/fantasy.git
cd fantasy
```

### 2. Launch with Docker Compose
```bash
docker compose up -d
```

### 3. Access the Web Interface & Connect ESPN
1. Open your browser to **[http://localhost:4477](http://localhost:4477)**.
2. If this is your first time running the app, the **ESPN League Connection** modal will automatically appear (or click `⚙️ Connect ESPN` in the top right navbar).
3. Enter your:
   - **Season Year** (e.g. `2026`)
   - **League ID** (from your ESPN fantasy league URL)
   - **SWID Cookie** (e.g. `{12345678-ABCD-EF01-2345-6789ABCDEF01}`)
   - **espn_s2 Cookie** (your private 200+ character ESPN session cookie)
4. Click **Test & Save Connection**. The app tests credentials directly with the ESPN Fantasy API and immediately populates your league rosters and matchups!

> **Persistence**: Your credentials, formula tuning preferences, and learning history are automatically persisted on your host volume, surviving container restarts and image updates.

---

## 🛠️ Local Development Setup

If you prefer running natively with Node.js:

### Prerequisites
- Node.js 18+ installed

### Steps
```bash
# 1. Enter the app directory
cd app

# 2. Install dependencies
npm install

# 3. (Optional) Copy example configuration
cp config.example.json config.json

# 4. Start the server
node server.js
```

The application will be running at `http://localhost:4477`.

---

## 🔑 How to Find Your ESPN SWID & espn_s2 Cookies

For private ESPN leagues, ESPN requires two cookie values to access roster and matchup data:

1. In your browser (Chrome, Edge, Firefox, or Safari), navigate to [fantasy.espn.com](https://fantasy.espn.com) and make sure you are logged in.
2. Press **F12** (or right-click anywhere and select **Inspect**) to open Developer Tools.
3. Switch to the **Application** tab (in Firefox, **Storage**; in Safari, **Storage**).
4. In the left panel, expand **Cookies** and click `https://fantasy.espn.com`.
5. Locate the two cookies:
   - `SWID`: Copy the entire value, including the curly braces (e.g. `{A1B2C3D4-...}`).
   - `espn_s2`: Copy the entire long string (starts with `AE...`).
6. Paste these into the in-app connection modal or your `.env` / `config.json`.

---

## ⚙️ Environment Variables (Headless Docker)

If deploying to headless environments like Unraid, Portainer, or Kubernetes, you can pass credentials via environment variables instead of using the UI:

| Variable | Description | Default |
|---|---|---|
| `PORT` | Web server listening port | `4477` |
| `ESPN_SEASON` | NFL season year | `2026` |
| `ESPN_LEAGUE_ID` | Your ESPN fantasy league ID | *(empty)* |
| `ESPN_SWID` | ESPN SWID cookie | *(empty)* |
| `ESPN_S2` | ESPN espn_s2 cookie | *(empty)* |

---

## 📁 Repository Structure

```
.
├── Dockerfile                  # Lightweight Alpine production container
├── docker-compose.yml          # Compose specification with persistent volumes
├── .dockerignore               # Optimized Docker build context exclusions
├── .gitignore                  # Security-first gitignore (protects private cookies)
├── README.md                   # Project documentation
└── app/
    ├── package.json            # Node.js dependencies
    ├── server.js               # Express API and ESPN/Sleeper data proxy
    ├── projectionEngine.js     # Mathematical projection calculation engine
    ├── kalshiService.js        # Kalshi NFL player prop markets integration
    ├── learningEngine.js       # Post-week calibration and backtesting
    ├── formula_config.json     # Active tuning weights and scoring system
    ├── learning_history.json   # Machine learning adjustment records
    └── public/
        └── index.html          # Responsive glassmorphic frontend UI
```

---

## 🔒 Security Note

- **Never commit `config.json`** to any public or private git repository. It contains private ESPN session cookies (`SWID` and `espn_s2`).
- The project's `.gitignore` and `.dockerignore` are pre-configured to strictly ignore `config.json`, keeping your account secure.
