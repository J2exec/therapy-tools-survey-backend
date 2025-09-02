# Backend Survey Tagging System Requirements

## Overview
The frontend onboarding survey is already deployed and needs a backend endpoint to store user survey responses as tags for Kit.com email automation.

## 🎯 Primary Endpoint Required

### `POST /api/survey-submission`

**Purpose:** Store survey responses and sync tags to Kit.com for automated email flows

**Frontend Call Location:** `onboarding.html` line 696

---

## 📋 Request Payload Structure

The frontend sends this exact payload:

```json
{
  "name": "Dr. Sarah Smith",
  "email": "sarah@therapist.com",
  "surveyData": {
    "setting": "setting_mixed",
    "profession": "role_therapist", 
    "populations": ["pop_adults", "pop_couples"],
    "interests": ["interest_art", "interest_feelings_wheel"],
    "frequency": "freq_weekly",
    "modalities": ["mod_cbt", "mod_solutions"],
    "profession_other": "Custom text if role_other selected",
    "modality_other": "Custom text if mod_other selected"
  },
  "recommendations": ["Creative Canvas", "Feelings Wheel"],
  "selectedTags": [
    "setting_mixed", 
    "role_therapist", 
    "pop_adults", 
    "pop_couples", 
    "interest_art", 
    "interest_feelings_wheel", 
    "freq_weekly", 
    "mod_cbt", 
    "mod_solutions"
  ],
  "customResponses": {
    "role_other": "Custom profession text",
    "mod_other": "Custom modality text"
  },
  "timestamp": "2025-09-01T12:00:00.000Z",
  "completed": true
}
```

---

## 🗄️ Database Schema Required

### SurveyResponses Table
```sql
CREATE TABLE SurveyResponses (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    TherapistId NVARCHAR(255),
    Email NVARCHAR(255) NOT NULL,
    Name NVARCHAR(255),
    SurveyData NVARCHAR(MAX), -- JSON blob of complete survey
    Recommendations NVARCHAR(MAX), -- JSON array of tool recommendations
    CompletedAt DATETIME2 DEFAULT GETDATE(),
    KitSyncStatus NVARCHAR(50) DEFAULT 'pending' -- 'success', 'failed', 'pending'
);
```

### UserTags Table
```sql
CREATE TABLE UserTags (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    TherapistId NVARCHAR(255),
    Email NVARCHAR(255) NOT NULL,
    TagName NVARCHAR(100) NOT NULL,
    TagSource NVARCHAR(50) DEFAULT 'survey', -- 'survey', 'manual', 'import'
    CreatedAt DATETIME2 DEFAULT GETDATE(),
    UNIQUE(Email, TagName)
);
```

---

## ⚙️ Backend Processing Logic

### 1. Receive and Validate Request
- Validate JSON payload structure
- Check required fields: `email`, `selectedTags`, `surveyData`
- Sanitize all inputs

### 2. User Lookup
- Find existing user by email in your user/therapist table
- Extract `TherapistId` for database relations
- Handle case where user doesn't exist (error or create stub)

### 3. Store Survey Response
```sql
INSERT INTO SurveyResponses (TherapistId, Email, Name, SurveyData, Recommendations, KitSyncStatus)
VALUES (@therapistId, @email, @name, @surveyDataJson, @recommendationsJson, 'pending')
```

### 4. Store Individual Tags
```sql
-- Insert each tag from selectedTags array
INSERT INTO UserTags (TherapistId, Email, TagName, TagSource)
VALUES (@therapistId, @email, @tagName, 'survey')
ON DUPLICATE KEY UPDATE CreatedAt = GETDATE() -- Update timestamp if tag exists
```

### 5. Kit.com Integration
Send tags to Kit.com API immediately after database save:

```javascript
const kitPayload = {
  email: email,
  tags: selectedTags.map(tag => ({ name: tag }))
};

const kitResponse = await fetch('https://api.kit.com/subscribers', {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${KIT_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(kitPayload)
});

// Update sync status in database
const syncStatus = kitResponse.ok ? 'success' : 'failed';
// UPDATE SurveyResponses SET KitSyncStatus = @syncStatus WHERE Email = @email
```

---

## 📤 Response Format

### Success Response (200)
```json
{
  "success": true,
  "message": "Survey data saved and tags applied",
  "data": {
    "tagsAdded": 9,
    "recommendationsCount": 2,
    "kitSyncStatus": "success"
  }
}
```

### Error Response (400/500)
```json
{
  "success": false,
  "error": "Validation failed",
  "message": "Email is required",
  "details": {
    "field": "email",
    "code": "MISSING_REQUIRED_FIELD"
  }
}
```

---

## 🔒 Security & Validation

### Input Validation
- Email format validation
- Maximum payload size limit (10KB recommended)
- Sanitize all string inputs for SQL injection
- Validate `selectedTags` is array of strings

### Rate Limiting
- Limit to 5 requests per minute per IP
- Prevent survey spam/abuse

### CORS Headers
```javascript
res.setHeader('Access-Control-Allow-Origin', 'https://your-frontend-domain.com');
res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
```

---

## 🏗️ Additional Endpoints Needed

Based on frontend middleware, these endpoints would be beneficial:

### `GET /api/user/tags/{email}`
**Purpose:** Retrieve current tags for a user
```json
{
  "email": "user@example.com",
  "tags": ["role_therapist", "setting_mixed", "pop_adults"],
  "lastUpdated": "2025-09-01T12:00:00.000Z"
}
```

### `POST /api/user/tags`
**Purpose:** Add/update individual tags
```json
{
  "email": "user@example.com",
  "tags": ["new_tag_1", "new_tag_2"],
  "source": "manual"
}
```

### `GET /api/health-check`
**Purpose:** System health check for middleware
```json
{
  "status": "healthy",
  "database": "connected",
  "kitApi": "accessible"
}
```

---

## 🔄 Error Handling Strategy

### Database Failures
- Return 500 error but don't lose data
- Implement retry mechanism for Kit.com sync
- Log errors for debugging

### Kit.com API Failures
- Save to database even if Kit sync fails
- Mark `KitSyncStatus` as 'failed'
- Implement background retry job for failed syncs
- Return success to frontend (don't break user experience)

### Duplicate Submissions
- Check for existing survey response by email
- Either update existing or prevent duplicates based on business logic

---

## 🚀 Deployment Notes

### Environment Variables Required
```
KIT_API_KEY=your_kit_api_key_here
DATABASE_CONNECTION_STRING=your_db_connection
FRONTEND_DOMAIN=https://your-frontend-domain.com
```

### Azure Function Configuration
- Runtime: Node.js 18+ or .NET 6+
- Timeout: 60 seconds (for Kit.com API calls)
- Memory: 512MB minimum

---

## 📊 Monitoring & Logging

### Key Metrics to Track
- Survey completion rate
- Kit.com sync success rate
- Response time for `/api/survey-submission`
- Error rates by type

### Logging Requirements
- Log all survey submissions (without PII in logs)
- Log Kit.com API failures for retry
- Log validation errors for debugging

---

## 🧪 Testing Checklist

### Test Cases Required
- [ ] Valid survey submission saves to database
- [ ] Tags sync to Kit.com successfully  
- [ ] Invalid email returns 400 error
- [ ] Missing required fields return validation errors
- [ ] Kit.com API failure doesn't break submission
- [ ] Duplicate tag handling works correctly
- [ ] CORS headers allow frontend domain
- [ ] Rate limiting prevents abuse

---

## 📋 Frontend Integration Notes

The frontend is already deployed with this endpoint call. The middleware will:
- Retry failed requests automatically
- Show user-friendly error messages
- Preserve survey data in browser storage until successful submission
- Fall back gracefully if middleware isn't loaded

**Current Status:** Frontend is waiting for this backend endpoint to go live.

---

## 🚀 Current Frontend Status & Endpoint Priority

### **Primary Endpoint (Critical - Deploy First):**
- `POST /api/survey-submission` - **This is what's deployed and calling right now**

### **Optional Endpoints (Nice to Have - Can Deploy Later):**
The middleware supports these, but they're not critical for initial deployment:
- `GET /api/user/tags/{email}` - For retrieving current user tags
- `POST /api/user/tags` - For manually updating tags  
- `GET /api/health-check` - For system monitoring

### **What's Happening Right Now:**
Your deployed onboarding survey is currently:
1. ✅ **Collecting all survey data** (6 questions + recommendations)
2. ✅ **Processing tags** from responses into selectedTags array
3. ⏳ **Calling `/api/survey-submission`** (will show error until backend is ready)
4. ✅ **Preserving data in sessionStorage** if submission fails
5. ✅ **Showing user-friendly error messages** instead of breaking

### **User Experience Right Now:**
- User completes survey → sees "Survey saved locally. Will retry when connection improves."
- When backend goes live → all stored survey data will submit automatically
- **No data loss, just graceful degradation**

### **Deployment Impact:**
- **Before backend:** Survey works but shows friendly error message
- **After backend:** Survey works completely with Kit.com tag automation
- **Zero downtime:** Frontend handles the transition seamlessly

The frontend is production-ready and waiting for the backend endpoint!

Required tags these must be specific to the question # they are under:
(Full tag list– don’t infer or rename them)
Q1 – Setting
setting_inperson, setting_mostly_inperson, setting_mixed, setting_mostly_online, setting_online_only
Q2 – Profession / Role
role_therapist, role_social_worker, role_psychologist,
role_school_counselor, role_student, role_clergy,
role_sud_counselor, role_peer_specialist, role_other (+ free text)
Q3 – Population Served
pop_children10u, pop_teens, pop_adults,
pop_couples, pop_families, pop_groups, pop_all_day
Q4 – Interests
interest_sandtray, interest_art, interest_feelings_wheel,
interest_humans, interest_tumbling, interest_jeopardy,
interest_bingo, interest_mandala
Q5 – Frequency
freq_daily, freq_weekly, freq_monthly, freq_occasionally
Q6 – Modalities
mod_cbt, mod_dbt, mod_solutions, mod_expressive,
mod_emdr, mod_couples, mod_ifs, mod_eclectic, mod_other (+ free text)

For free text, that is not a tag, but a text field they fill out. For that one, store the answer to our table, but do not send free text to kit.