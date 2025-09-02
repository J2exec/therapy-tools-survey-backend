# Real-Time Survey Updates - Frontend Integration Guide

## 🚀 Implementation Strategy

The backend is configured for **real-time updates** - each question answer is saved immediately when the user makes a selection and moves to the next question.

## 📡 API Endpoints for Real-Time Updates

### 1. Update Individual Question Answer
```javascript
POST /api/question/update

// Request Body:
{
  "email": "user@therapist.com",
  "questionNumber": 1,
  "answer": "setting_mixed",
  "otherText": null  // Optional: only for Q2 or Q6 when "other" is selected
}
```

### 2. Get All Current Answers
```javascript
GET /api/question/answers/user@therapist.com

// Response:
{
  "email": "user@therapist.com",
  "answers": {
    "Q1": "setting_mixed",
    "Q2": "role_therapist", 
    "Q3": ["pop_adults", "pop_couples"],
    "Q4": ["interest_art"],
    "Q5": "freq_weekly",
    "Q6": ["mod_cbt", "mod_solutions"],
    "Q2_other": "",
    "Q6_other": ""
  },
  "completed": false,
  "lastUpdated": "2025-09-01T12:00:00Z"
}
```

### 3. Final Survey Submission (Still Required)
```javascript
POST /api/survey-submission
// Complete survey data - validates all answers and syncs to Kit.com
```

## 🎯 Frontend Integration Examples

### JavaScript/Fetch Implementation

```javascript
class SurveyManager {
  constructor(userEmail) {
    this.userEmail = userEmail;
    this.baseUrl = 'https://your-function-app.azurewebsites.net/api';
  }

  // Save answer when user selects and moves to next question
  async saveQuestionAnswer(questionNumber, answer, otherText = null) {
    try {
      const response = await fetch(`${this.baseUrl}/question/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: this.userEmail,
          questionNumber: questionNumber,
          answer: answer,
          otherText: otherText
        })
      });

      const result = await response.json();
      
      if (result.success) {
        console.log(`Q${questionNumber} saved successfully`);
        return true;
      } else {
        console.error('Failed to save answer:', result.message);
        return false;
      }
    } catch (error) {
      console.error('Network error saving answer:', error);
      return false;
    }
  }

  // Load existing answers when user returns to survey
  async loadExistingAnswers() {
    try {
      const response = await fetch(`${this.baseUrl}/question/answers/${encodeURIComponent(this.userEmail)}`);
      const result = await response.json();
      
      if (response.ok) {
        return result.answers;
      } else {
        console.error('Failed to load answers:', result.message);
        return {};
      }
    } catch (error) {
      console.error('Network error loading answers:', error);
      return {};
    }
  }

  // Submit complete survey (validates and syncs to Kit.com)
  async submitCompleteSurvey(surveyData) {
    try {
      const response = await fetch(`${this.baseUrl}/survey-submission`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(surveyData)
      });

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Network error submitting survey:', error);
      return { success: false, error: 'Network error' };
    }
  }
}
```

### Usage Examples

```javascript
// Initialize survey manager
const survey = new SurveyManager('user@therapist.com');

// When user completes Q1 and clicks "Next"
await survey.saveQuestionAnswer(1, 'setting_mixed');

// When user completes Q3 (multiple selections) and clicks "Next" 
await survey.saveQuestionAnswer(3, ['pop_adults', 'pop_couples']);

// When user selects "Other" in Q2 and provides custom text
await survey.saveQuestionAnswer(2, 'role_other', 'Custom profession description');

// When user returns to survey, load their previous answers
const existingAnswers = await survey.loadExistingAnswers();
// Pre-populate form fields with existingAnswers.Q1, existingAnswers.Q2, etc.

// When user completes entire survey, submit final data
const finalResult = await survey.submitCompleteSurvey({
  name: "Dr. Sarah Smith",
  email: "user@therapist.com",
  surveyData: {
    setting: "setting_mixed",
    profession: "role_therapist",
    populations: ["pop_adults", "pop_couples"],
    interests: ["interest_art"],
    frequency: "freq_weekly", 
    modalities: ["mod_cbt", "mod_solutions"]
  },
  recommendations: ["Creative Canvas", "Feelings Wheel"],
  selectedTags: ["setting_mixed", "role_therapist", "pop_adults", "pop_couples", "interest_art", "freq_weekly", "mod_cbt", "mod_solutions"],
  customResponses: { role_other: "", mod_other: "" },
  timestamp: new Date().toISOString(),
  completed: true
});
```

## 📱 React/Vue Component Example

```javascript
// React component example
function SurveyQuestion({ questionNumber, userEmail, onNext }) {
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleNext = async () => {
    if (!selectedAnswer) return;
    
    setIsLoading(true);
    
    // Save answer in real-time
    const success = await survey.saveQuestionAnswer(questionNumber, selectedAnswer);
    
    if (success) {
      onNext(); // Move to next question
    } else {
      alert('Failed to save answer. Please try again.');
    }
    
    setIsLoading(false);
  };

  return (
    <div>
      {/* Question UI */}
      <button onClick={handleNext} disabled={isLoading}>
        {isLoading ? 'Saving...' : 'Next'}
      </button>
    </div>
  );
}
```

## 🔄 Data Flow with Real-Time Updates

### User Journey:
1. **User starts survey** → Load existing answers if any
2. **User answers Q1** → Click "Next" → Save to Q1 field
3. **User answers Q2** → Click "Next" → Save to Q2 field  
4. **User closes browser** → Data is preserved in Q1, Q2 fields
5. **User returns later** → Load existing answers, continue from Q3
6. **User completes survey** → Final submission validates all answers and syncs to Kit.com

### Benefits:
- ✅ **No data loss** if user abandons survey mid-way
- ✅ **Resume capability** - users can return and continue where they left off
- ✅ **Progress tracking** - you can see which questions users struggle with
- ✅ **Better UX** - immediate feedback that answers are saved

## 🛠️ Error Handling

```javascript
// Robust error handling example
async function saveAnswerWithRetry(questionNumber, answer, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const success = await survey.saveQuestionAnswer(questionNumber, answer);
      if (success) return true;
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);
      if (attempt === maxRetries) {
        // Store locally as fallback
        localStorage.setItem(`survey_q${questionNumber}`, JSON.stringify(answer));
        return false;
      }
    }
  }
}
```

## 📊 Analytics Opportunities

With real-time updates, you can now track:
- **Drop-off rates** by question number
- **Time spent** on each question
- **Incomplete surveys** for follow-up
- **Popular answer combinations**

The backend is ready for real-time updates! Your users will have a much better experience with automatic progress saving.
