const { app } = require('@azure/functions');

// Import service modules
const { 
  ensureTablesExist, 
  getSubscriberByEmail, 
  updateSubscriberTags, 
  insertSurveyResponse, 
  updateKitSyncStatus,
  updateQuestionAnswer,
  getQuestionAnswers,
  getSurveyProgress,
  testConnection
} = require('./services/azureStorage');
const { syncTagsToKit, testKitConnection } = require('./services/kitApi');
const { validateSurveyRequest, sanitizeInput, validateTags } = require('./utils/validation');
const Joi = require('joi');

// Validation schema for the survey request (matching frontend payload)
const surveySchema = Joi.object({
  name: Joi.string().max(255).required(),
  email: Joi.string().email().required(),
  surveyData: Joi.object({
    setting: Joi.string().valid(
      'setting_inperson', 'setting_mostly_inperson', 'setting_mixed', 
      'setting_mostly_online', 'setting_online_only'
    ).required(),
    profession: Joi.string().valid(
      'role_therapist', 'role_social_worker', 'role_psychologist',
      'role_school_counselor', 'role_student', 'role_clergy',
      'role_sud_counselor', 'role_peer_specialist', 'role_other'
    ).required(),
    populations: Joi.array().items(Joi.string().valid(
      'pop_children10u', 'pop_teens', 'pop_adults',
      'pop_couples', 'pop_families', 'pop_groups', 'pop_all_day'
    )).required(),
    interests: Joi.array().items(Joi.string().valid(
      'interest_sandtray', 'interest_art', 'interest_feelings_wheel',
      'interest_humans', 'interest_tumbling', 'interest_jeopardy',
      'interest_bingo', 'interest_mandala'
    )).required(),
    frequency: Joi.string().valid(
      'freq_daily', 'freq_weekly', 'freq_monthly', 'freq_occasionally'
    ).required(),
    modalities: Joi.array().items(Joi.string().valid(
      'mod_cbt', 'mod_dbt', 'mod_solutions', 'mod_expressive',
      'mod_emdr', 'mod_couples', 'mod_ifs', 'mod_eclectic', 'mod_other'
    )).required(),
    profession_other: Joi.string().max(255).allow('').optional(),
    modality_other: Joi.string().max(255).allow('').optional()
  }).required(),
  recommendations: Joi.array().items(Joi.string()).optional(),
  selectedTags: Joi.array().items(Joi.string()).required(),
  customResponses: Joi.object({
    role_other: Joi.string().max(255).allow('').optional(),
    mod_other: Joi.string().max(255).allow('').optional()
  }).optional(),
  timestamp: Joi.string().isoDate().required(),
  completed: Joi.boolean().required()
});

// CORS headers helper
const getCorsHeaders = () => ({
  'Access-Control-Allow-Origin': process.env.FRONTEND_DOMAIN || '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
});

// 1. Survey Submission Function
app.http('surveySubmission', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'survey-submission',
  handler: async (request, context) => {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return { status: 200, headers: getCorsHeaders() };
    }

    try {
      // Parse and validate request
      const requestBody = await request.json();
      const { error, value } = surveySchema.validate(requestBody);
      
      if (error) {
        return {
          status: 400,
          headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Validation failed',
            message: error.details[0].message,
            details: {
              field: error.details[0].path.join('.'),
              code: 'VALIDATION_ERROR'
            }
          })
        };
      }

      // Ensure tables exist
      await ensureTablesExist();

      // Get subscriber (therapist)
      const subscriber = await getSubscriberByEmail(value.email);
      if (!subscriber) {
        return {
          status: 404,
          headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Subscriber not found',
            message: 'Email not found in subscriber database'
          })
        };
      }

      // Store survey response (complete survey data)
      await insertSurveyResponse({
        therapistId: subscriber.rowKey,
        email: value.email,
        name: value.name,
        surveyData: value.surveyData,
        recommendations: value.recommendations || [],
        selectedTags: value.selectedTags,
        customResponses: value.customResponses || {},
        timestamp: value.timestamp,
        completed: value.completed,
        kitSyncStatus: 'pending'
      });

      // Store individual tags (from selectedTags array)
      const tagPromises = value.selectedTags.map(tagName => 
        updateSubscriberTags(subscriber.rowKey, {
          tagName: tagName,
          email: value.email,
          tagSource: 'survey',
          createdAt: new Date().toISOString()
        })
      );
      await Promise.all(tagPromises);

      // Sync to Kit.com using selectedTags
      let kitSyncStatus = 'pending';
      let kitError = null;
      
      try {
        const kitResult = await syncTagsToKit(value.email, value.selectedTags);
        kitSyncStatus = kitResult.success ? 'success' : 'failed';
        kitError = kitResult.error;
        
        // Update sync status in survey response
        await updateKitSyncStatus(subscriber.rowKey, kitSyncStatus, kitError);
        
      } catch (kitApiError) {
        context.log.warn('Kit.com sync failed:', kitApiError);
        kitSyncStatus = 'failed';
        kitError = kitApiError.message;
        await updateKitSyncStatus(subscriber.rowKey, 'failed', kitError);
      }

      // Return success response (as per requirements format)
      return {
        status: 200,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: 'Survey data saved and tags applied',
          data: {
            tagsAdded: value.selectedTags.length,
            recommendationsCount: (value.recommendations || []).length,
            kitSyncStatus: kitSyncStatus
          }
        })
      };

    } catch (error) {
      context.log.error('Survey submission error:', error);
      return {
        status: 500,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Internal server error',
          message: 'An error occurred while processing your survey submission',
          details: {
            code: 'INTERNAL_ERROR'
          }
        })
      };
    }
  }
});

// 2. Question Update Function
app.http('questionUpdate', {
  methods: ['POST', 'GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'question/{action?}',
  handler: async (request, context) => {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return { status: 200, headers: getCorsHeaders() };
    }

    const action = request.params.action;

    try {
      switch (action) {
        case 'update':
          return await handleQuestionUpdate(request, context);
        case 'answers':
          return await handleGetAnswers(request, context);
        case 'progress':
          return await handleGetProgress(request, context);
        default:
          return {
            status: 400,
            headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: 'Invalid action. Use: update, answers, or progress'
            })
          };
      }
    } catch (error) {
      context.log.error('Question update error:', error);
      return {
        status: 500,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Internal server error'
        })
      };
    }
  }
});

// 4. Get User Tags Function
app.http('getUserTags', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'user/tags/{email}',
  handler: async (request, context) => {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return { status: 200, headers: getCorsHeaders() };
    }

    const email = request.params.email;

    if (!email) {
      return {
        status: 400,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Email parameter is required'
        })
      };
    }

    try {
      const subscriber = await getSubscriberByEmail(email);
      if (!subscriber) {
        return {
          status: 404,
          headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'User not found'
          })
        };
      }

      // Get user tags from storage
      const userTags = await getUserTags(email);
      
      return {
        status: 200,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          tags: userTags.map(tag => tag.tagName),
          lastUpdated: userTags.length > 0 ? userTags[0].createdAt : null
        })
      };

    } catch (error) {
      context.log.error('Get user tags error:', error);
      return {
        status: 500,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Internal server error'
        })
      };
    }
  }
});

// 5. Update User Tags Function
app.http('updateUserTags', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'user/tags',
  handler: async (request, context) => {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return { status: 200, headers: getCorsHeaders() };
    }

    try {
      const requestBody = await request.json();
      
      const tagUpdateSchema = Joi.object({
        email: Joi.string().email().required(),
        tags: Joi.array().items(Joi.string()).required(),
        source: Joi.string().valid('manual', 'survey', 'import').default('manual')
      });

      const { error, value } = tagUpdateSchema.validate(requestBody);
      if (error) {
        return {
          status: 400,
          headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Validation failed',
            details: error.details[0].message
          })
        };
      }

      const subscriber = await getSubscriberByEmail(value.email);
      if (!subscriber) {
        return {
          status: 404,
          headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'User not found'
          })
        };
      }

      // Add/update tags
      const tagPromises = value.tags.map(tagName => 
        updateSubscriberTags(subscriber.rowKey, {
          tagName: tagName,
          email: value.email,
          tagSource: value.source,
          createdAt: new Date().toISOString()
        })
      );
      await Promise.all(tagPromises);

      return {
        status: 200,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: 'Tags updated successfully',
          tagsAdded: value.tags.length
        })
      };

    } catch (error) {
      context.log.error('Update user tags error:', error);
      return {
        status: 500,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Internal server error'
        })
      };
    }
  }
});
app.http('health', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return { status: 200, headers: getCorsHeaders() };
    }

    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      azureStorage: 'unknown',
      kitApi: 'unknown',
      environment: process.env.NODE_ENV || 'development'
    };

    try {
      // Test Azure Storage
      const storageConnected = await testConnection();
      healthStatus.azureStorage = storageConnected ? 'connected' : 'disconnected';
      if (!storageConnected) healthStatus.status = 'unhealthy';

      // Test Kit.com API
      const kitTest = await testKitConnection();
      healthStatus.kitApi = kitTest.success ? 'accessible' : 'error';
      if (!kitTest.success) healthStatus.status = 'degraded';

      const statusCode = healthStatus.status === 'healthy' ? 200 : 
                        healthStatus.status === 'degraded' ? 206 : 503;

      return {
        status: statusCode,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(healthStatus)
      };

    } catch (error) {
      context.log.error('Health check error:', error);
      return {
        status: 503,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'unhealthy',
          error: 'Health check failed',
          timestamp: new Date().toISOString()
        })
      };
    }
  }
});

// Helper functions for question operations
async function handleQuestionUpdate(request, context) {
  const requestBody = await request.json();
  
  const updateSchema = Joi.object({
    email: Joi.string().email().required(),
    questionNumber: Joi.string().pattern(/^Q[1-6]$/).required(),
    answer: Joi.string().max(500).required(),
    timestamp: Joi.string().isoDate().required()
  });

  const { error, value } = updateSchema.validate(requestBody);
  if (error) {
    return {
      status: 400,
      headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Validation failed',
        details: error.details[0].message
      })
    };
  }

  await updateQuestionAnswer(value.email, value.questionNumber, value.answer, value.timestamp);

  return {
    status: 200,
    headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      message: 'Question answer updated successfully',
      questionNumber: value.questionNumber,
      timestamp: new Date().toISOString()
    })
  };
}

async function handleGetAnswers(request, context) {
  const email = request.query.get('email');
  
  if (!email) {
    return {
      status: 400,
      headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Email parameter is required'
      })
    };
  }

  const answers = await getQuestionAnswers(email);
  
  return {
    status: 200,
    headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      email: email,
      answers: answers,
      timestamp: new Date().toISOString()
    })
  };
}

async function handleGetProgress(request, context) {
  const email = request.query.get('email');
  
  if (!email) {
    return {
      status: 400,
      headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Email parameter is required'
      })
    };
  }

  const progress = await getSurveyProgress(email);
  
  return {
    status: 200,
    headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      email: email,
      progress: progress,
      timestamp: new Date().toISOString()
    })
  };
}
