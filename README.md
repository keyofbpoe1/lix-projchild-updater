# LeanIX Project Child Progress Updater

This service listens for LeanIX webhook events, retrieves a Project and its child Projects, calculates overall completion progress, and updates the parent Project’s `projectStatus` field accordingly.

---

## 🚀 Overview

When a webhook is triggered:

1. Fetch the parent Project and its child Projects
2. Extract each child project's `progress`
3. Treat missing/null progress as `0`
4. Calculate the overall progress (average of all children)
5. Update the parent Project’s `projectStatus` in LeanIX with:
   - Current date
   - Calculated progress
   - Descriptive summary
   - Detailed breakdown of all child projects (name, progress, description)

---

## 📊 Calculation Logic

- Every child project is included
- `projectStatus: null` → treated as `progress = 0`

- `description: null` → replaced with:
  "0 applications related to this project (0%) have been marked as completed."
- Formula:

```
overallProgress = sum(child progresses) / total children
```

Each child project is listed in the description using the format:

- {Project Name}: {Progress}% — {Description}

Example:

- CRM Upgrade: 100% — Completed rollout
- Data Migration: 0% — 0 applications related to this project (0%) have been marked as completed.

---

## 🧩 Example Output

```json
{
  "projectId": "123",
  "overallProgress": 67,
  "description": "3 child projects with an average completion of 67%.\nThis value is calculated as the mean of all child project progress values, with missing progress treated as 0%.\n\nSub-project breakdown:\n- Project A: 100% — Completed rollout\n- Project B: 50% — In progress\n- Project C: 0% — 0 applications related to this project (0%) have been marked as completed."
}
```

---

## ⚙️ Environment Variables

Create a `.env` file with:

```env
LEANIX_BASE_URL=https://app.leanix.net
LEANIX_CLIENT_ID=your_client_id
LEANIX_CLIENT_SECRET=your_client_secret
PORT=3000
```

---

## 📦 Install & Run Locally

```bash
npm install
npm start
```

Server runs at:

```
http://localhost:3000
```

---

## 🔗 Webhook Endpoint

```
POST /leanix-webhook
```

### Example Test

```bash
curl -X POST http://localhost:3000/leanix-webhook -H "Content-Type: application/json" -d '{"factSheet": { "id": "YOUR_PROJECT_ID" }}'
```

---

## ☁️ Deployment (Render)

This service is designed to be deployed on **Render** as a Web Service.

### ✅ Steps

1. Push code to GitHub
2. Create a new **Web Service** on Render
3. Configure:

- **Build Command**
  ```
  npm install
  ```

- **Start Command**
  ```
  npm start
  ```

4. Add Environment Variables in Render:
   - `LEANIX_BASE_URL`
   - `LEANIX_CLIENT_ID`
   - `LEANIX_CLIENT_SECRET`

5. Set the webhook URL in LeanIX to:

```
https://your-render-service.onrender.com/leanix-webhook
```

---

## 🛠 Tech Stack

- Node.js
- Express
- Axios
- LeanIX GraphQL API

---

## ✅ Notes

- Uses a single optimized GraphQL query (no loops or batching)
- Handles missing data safely
- Automatically updates LeanIX Project status
- Built for webhook-driven automation
- Includes detailed sub-project breakdown in the status description

---

## 📌 Future Enhancements

- Only update if progress changes
- Add project health status (On Track / At Risk)
- Weighted progress calculations
- Logging & monitoring

---

## 👨‍💻 Author

Internal LeanIX Automation Service
