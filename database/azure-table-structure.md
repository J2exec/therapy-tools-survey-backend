# Azure Table Storage Structure for Therapy Tools Survey Hub

## Table: `subscribers` (Existing Table Enhanced)

### Current Structure (You mentioned these exist)
- **Email** (String) - Primary identifier
- **Name** (String) - Subscriber name  
- **Password** (String) - Hashed password
- **RegistrationDate** (DateTime) - When they registered

### New Survey Fields Added by Backend
- **surveyCompleted** (Boolean) - Whether survey is completed
- **surveyCompletedAt** (DateTime) - When survey was completed
- **lastSurveyData** (JSON String) - Complete survey data backup

### Question-Based Tag Fields (Required for each question)
- **Q1** (String) - Q1: Setting - Single tag (setting_inperson, setting_mixed, etc.)
- **Q2** (String) - Q2: Profession - Single tag (role_therapist, role_social_worker, etc.)
- **Q3** (JSON Array String) - Q3: Population - Multiple tags (pop_adults, pop_couples, etc.)
- **Q4** (JSON Array String) - Q4: Interests - Multiple tags (interest_art, interest_feelings_wheel, etc.)
- **Q5** (String) - Q5: Frequency - Single tag (freq_daily, freq_weekly, etc.)
- **Q6** (JSON Array String) - Q6: Modalities - Multiple tags (mod_cbt, mod_dbt, etc.)

### Free Text Fields (NOT sent to Kit.com)
- **Q2_other** (String) - Free text when role_other selected in Q2
- **Q6_other** (String) - Free text when mod_other selected in Q6

### All Tags Combined
- **allSelectedTags** (JSON Array String) - All predefined tags for Kit.com sync
- **customResponses** (JSON String) - All free text responses

### Kit.com Integration Fields
- **kitSyncStatus** (String) - 'pending', 'success', 'failed'
- **kitSyncedAt** (DateTime) - When successfully synced to Kit.com

### Metadata
- **updatedAt** (DateTime) - Last update timestamp

## Table: `surveyresponses` (New Table for Audit Trail)

### Structure
- **PartitionKey** (String) - Email address for efficient querying
- **RowKey** (String) - Unique response ID (email_timestamp)
- **email** (String) - Subscriber email
- **name** (String) - Subscriber name at time of submission
- **surveyData** (JSON String) - Complete survey data
- **recommendations** (JSON Array String) - Tool recommendations given
- **selectedTags** (JSON Array String) - All selected tags
- **customResponses** (JSON String) - Free text responses
- **completedAt** (DateTime) - Submission timestamp
- **kitSyncStatus** (String) - 'pending', 'success', 'failed'
- **kitSyncedAt** (DateTime) - Kit.com sync timestamp

## Exact Tag Values (Must Match Requirements Document)

### Q1 - Setting Tags
- `setting_inperson`
- `setting_mostly_inperson` 
- `setting_mixed`
- `setting_mostly_online`
- `setting_online_only`

### Q2 - Profession Tags
- `role_therapist`
- `role_social_worker`
- `role_psychologist`
- `role_school_counselor`
- `role_student`
- `role_clergy`
- `role_sud_counselor`
- `role_peer_specialist`
- `role_other` (+ free text in professionOther field)

### Q3 - Population Tags
- `pop_children10u`
- `pop_teens`
- `pop_adults`
- `pop_couples`
- `pop_families`
- `pop_groups`
- `pop_all_day`

### Q4 - Interest Tags
- `interest_sandtray`
- `interest_art`
- `interest_feelings_wheel`
- `interest_humans`
- `interest_tumbling`
- `interest_jeopardy`
- `interest_bingo`
- `interest_mandala`

### Q5 - Frequency Tags
- `freq_daily`
- `freq_weekly`
- `freq_monthly`
- `freq_occasionally`

### Q6 - Modality Tags
- `mod_cbt`
- `mod_dbt`
- `mod_solutions`
- `mod_expressive`
- `mod_emdr`
- `mod_couples`
- `mod_ifs`
- `mod_eclectic`
- `mod_other` (+ free text in modalityOther field)

## Data Flow

### Real-Time Question Updates (Optional)
1. **User selects answer** → Frontend calls `POST /api/question/update`
2. **Backend validates** answer and updates specific Q# field
3. **User proceeds** to next question with previous answers saved

### Final Survey Submission (Required)
1. **User completes survey** → Frontend calls `POST /api/survey-submission`
2. **Backend validates** subscriber exists and all answers are valid
3. **Backend creates** audit record in `surveyresponses` table
4. **Backend updates/confirms** all Q# fields in subscriber table
5. **Backend syncs** valid tags to Kit.com (excludes Q2_other, Q6_other)
6. **Backend updates** sync status in both tables

### Question Update Strategy
- **Option A**: Update each Q# field when user selects answer and moves to next question
- **Option B**: Update all Q# fields only when final survey is submitted
- **Recommended**: Option A for better user experience and data persistence

### Kit.com Integration Rules
- **Send**: Only predefined tags (no `_other` variants)
- **Don't Send**: Free text responses (professionOther, modalityOther)
- **Retry**: Failed syncs can be retried using stored data

## Azure Table Storage Considerations

### Partition Strategy
- **subscribers**: Use email or hash of email as PartitionKey
- **surveyresponses**: Use email as PartitionKey for efficient user queries

### Query Patterns
- Find subscriber by email: Filter on email field
- Get user's survey history: Query surveyresponses by PartitionKey (email)
- Find failed syncs: Filter on kitSyncStatus = 'failed'

### Performance
- Single subscriber lookup: O(1) with proper PartitionKey/RowKey
- User survey history: Efficient partition scan
- Failed sync queries: Table scan but infrequent

## Sample Data Structure

### Subscriber Record After Survey
```json
{
  "partitionKey": "user1",
  "rowKey": "sarah@therapist.com",
  "email": "sarah@therapist.com",
  "name": "Dr. Sarah Smith",
  "password": "hashed_password_here",
  "registrationDate": "2025-08-15T10:00:00Z",
  "surveyCompleted": true,
  "surveyCompletedAt": "2025-09-01T12:00:00Z",
  "Q1": "setting_mixed",
  "Q2": "role_therapist",
  "Q3": "[\"pop_adults\",\"pop_couples\"]",
  "Q4": "[\"interest_art\",\"interest_feelings_wheel\"]",
  "Q5": "freq_weekly",
  "Q6": "[\"mod_cbt\",\"mod_solutions\"]",
  "Q2_other": "",
  "Q6_other": "",
  "allSelectedTags": "[\"setting_mixed\",\"role_therapist\",\"pop_adults\",\"pop_couples\",\"interest_art\",\"interest_feelings_wheel\",\"freq_weekly\",\"mod_cbt\",\"mod_solutions\"]",
  "kitSyncStatus": "success",
  "kitSyncedAt": "2025-09-01T12:00:30Z",
  "updatedAt": "2025-09-01T12:00:30Z"
}
```

### Survey Response Record
```json
{
  "partitionKey": "sarah@therapist.com",
  "rowKey": "sarah@therapist.com_1725192000000",
  "email": "sarah@therapist.com",
  "name": "Dr. Sarah Smith",
  "surveyData": "{\"setting\":\"setting_mixed\",\"profession\":\"role_therapist\"...}",
  "recommendations": "[\"Creative Canvas\",\"Feelings Wheel\"]",
  "selectedTags": "[\"setting_mixed\",\"role_therapist\",\"pop_adults\"...]",
  "customResponses": "{\"role_other\":\"\",\"mod_other\":\"\"}",
  "completedAt": "2025-09-01T12:00:00Z",
  "kitSyncStatus": "success",
  "kitSyncedAt": "2025-09-01T12:00:30Z"
}
```
