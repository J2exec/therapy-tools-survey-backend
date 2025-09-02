const { TableServiceClient, TableClient } = require('@azure/data-tables');

let tableServiceClient;

/**
 * Initialize Azure Table Storage client
 */
function initializeTableClient() {
  if (!tableServiceClient) {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error('AZURE_STORAGE_CONNECTION_STRING environment variable is not set');
    }
    tableServiceClient = TableServiceClient.fromConnectionString(connectionString);
  }
  return tableServiceClient;
}

/**
 * Get table client for a specific table
 */
function getTableClient(tableName) {
  const serviceClient = initializeTableClient();
  return new TableClient(process.env.AZURE_STORAGE_CONNECTION_STRING, tableName);
}

/**
 * Ensure tables exist, create if they don't
 */
async function ensureTablesExist() {
  const serviceClient = initializeTableClient();
  
  const subscriberTableName = process.env.SUBSCRIBER_TABLE_NAME || 'subscribers';
  const surveyResponsesTableName = process.env.SURVEY_RESPONSES_TABLE_NAME || 'surveyresponses';
  
  try {
    // Create subscribers table if it doesn't exist
    await serviceClient.createTable(subscriberTableName);
    console.log(`Table ${subscriberTableName} created or already exists`);
  } catch (error) {
    if (error.statusCode !== 409) { // 409 = table already exists
      console.error(`Error creating ${subscriberTableName} table:`, error);
    }
  }
  
  try {
    // Create survey responses table if it doesn't exist
    await serviceClient.createTable(surveyResponsesTableName);
    console.log(`Table ${surveyResponsesTableName} created or already exists`);
  } catch (error) {
    if (error.statusCode !== 409) { // 409 = table already exists
      console.error(`Error creating ${surveyResponsesTableName} table:`, error);
    }
  }
}

/**
 * Find subscriber by email
 */
async function getSubscriberByEmail(email) {
  const tableName = process.env.SUBSCRIBER_TABLE_NAME || 'subscribers';
  const tableClient = getTableClient(tableName);
  
  try {
    // In Azure Table Storage, we'll use email as the row key for easy lookup
    // You may need to adjust this based on your existing table structure
    const entities = tableClient.listEntities({
      filter: `Email eq '${email}'`
    });
    
    for await (const entity of entities) {
      return entity;
    }
    return null;
  } catch (error) {
    console.error(`Error getting subscriber by email ${email}:`, error);
    throw error;
  }
}

/**
 * Update a single question's answer in real-time as user progresses
 */
async function updateQuestionAnswer(email, questionNumber, answer, otherText = null) {
  const tableName = process.env.SUBSCRIBER_TABLE_NAME || 'subscribers';
  const tableClient = getTableClient(tableName);
  
  try {
    // Find existing subscriber
    const subscriber = await getSubscriberByEmail(email);
    
    if (!subscriber) {
      throw new Error(`Subscriber with email ${email} not found`);
    }
    
    // Prepare the update object
    const updateData = {
      partitionKey: subscriber.partitionKey,
      rowKey: subscriber.rowKey,
      etag: subscriber.etag,
      updatedAt: new Date().toISOString()
    };
    
    // Update the specific question field
    const questionField = `Q${questionNumber}`;
    const otherField = `Q${questionNumber}_other`;
    
    // Handle different answer types
    if (Array.isArray(answer)) {
      // Multiple selection questions (Q3, Q4, Q6)
      updateData[questionField] = JSON.stringify(answer);
    } else {
      // Single selection questions (Q1, Q2, Q5)
      updateData[questionField] = answer;
    }
    
    // Handle "other" text responses
    if (otherText && (questionNumber === 2 || questionNumber === 6)) {
      updateData[otherField] = otherText;
    }
    
    // Update the entity
    await tableClient.updateEntity(updateData, 'Replace');
    
    console.log(`Updated ${questionField} for ${email} with answer:`, answer);
    return true;
    
  } catch (error) {
    console.error(`Error updating question ${questionNumber} for ${email}:`, error);
    throw error;
  }
}

/**
 * Check survey completion progress for a subscriber
 */
async function getSurveyProgress(email) {
  try {
    const subscriber = await getSubscriberByEmail(email);
    
    if (!subscriber) {
      return {
        email: email,
        exists: false,
        progress: 0,
        completedQuestions: [],
        nextQuestion: 1
      };
    }
    
    const completedQuestions = [];
    const questionProgress = {};
    
    // Check each question
    for (let i = 1; i <= 6; i++) {
      const questionField = `Q${i}`;
      if (subscriber[questionField]) {
        completedQuestions.push(i);
        questionProgress[questionField] = subscriber[questionField];
      }
    }
    
    const progressPercent = Math.round((completedQuestions.length / 6) * 100);
    const nextQuestion = completedQuestions.length < 6 ? completedQuestions.length + 1 : null;
    
    return {
      email: email,
      exists: true,
      progress: progressPercent,
      completedQuestions: completedQuestions,
      nextQuestion: nextQuestion,
      questionData: questionProgress,
      surveyCompleted: subscriber.surveyCompleted || false,
      lastUpdated: subscriber.updatedAt
    };
    
  } catch (error) {
    console.error(`Error getting survey progress for ${email}:`, error);
    throw error;
  }
}

/**
 * Get current answers for all questions for a subscriber
 */
async function getQuestionAnswers(email) {
  try {
    const subscriber = await getSubscriberByEmail(email);
    
    if (!subscriber) {
      return {
        email: email,
        answers: {},
        completed: false
      };
    }
    
    const answers = {};
    
    // Extract each question's answer
    for (let i = 1; i <= 6; i++) {
      const questionField = `Q${i}`;
      const otherField = `Q${i}_other`;
      
      if (subscriber[questionField]) {
        try {
          // Try to parse as JSON (for multiple selection questions)
          const parsed = JSON.parse(subscriber[questionField]);
          answers[questionField] = Array.isArray(parsed) ? parsed : subscriber[questionField];
        } catch (e) {
          // Single selection or string value
          answers[questionField] = subscriber[questionField];
        }
      }
      
      // Include "other" text if present
      if (subscriber[otherField]) {
        answers[otherField] = subscriber[otherField];
      }
    }
    
    return {
      email: email,
      answers: answers,
      completed: subscriber.surveyCompleted || false,
      lastUpdated: subscriber.updatedAt
    };
    
  } catch (error) {
    console.error(`Error getting question answers for ${email}:`, error);
    throw error;
  }
}
/**
 * Update subscriber tags - handles both individual tag updates and full survey data
 */
async function updateSubscriberTags(subscriberId, updateData) {
  const tableName = process.env.SUBSCRIBER_TABLE_NAME || 'subscribers';
  const tableClient = getTableClient(tableName);
  
  try {
    // If updateData has tagName, it's an individual tag update
    if (updateData.tagName) {
      // Individual tag update - store in a tags table or as individual fields
      // For now, we'll store it as a field on the subscriber entity
      const subscriber = await getSubscriberByEmail(updateData.email);
      if (!subscriber) {
        throw new Error(`Subscriber with email ${updateData.email} not found`);
      }
      
      const tagFieldName = `tag_${updateData.tagName}`;
      const tagUpdateEntity = {
        partitionKey: subscriber.partitionKey,
        rowKey: subscriber.rowKey,
        etag: subscriber.etag,
        [tagFieldName]: updateData.tagName,
        [`${tagFieldName}_source`]: updateData.tagSource || 'survey',
        [`${tagFieldName}_createdAt`]: updateData.createdAt || new Date().toISOString(),
        lastTagUpdate: new Date().toISOString()
      };
      
      await tableClient.updateEntity(tagUpdateEntity, 'Merge');
      console.log(`Individual tag ${updateData.tagName} updated for subscriber ${subscriberId}`);
      return;
    }
    
    // Full survey data update (legacy support)
    const subscriber = await getSubscriberByEmail(updateData.email || subscriberId);
    if (!subscriber) {
      throw new Error(`Subscriber ${subscriberId} not found`);
    }
    
    // Update with full survey data
    const tagUpdate = {
      partitionKey: subscriber.partitionKey,
      rowKey: subscriber.rowKey,
      etag: subscriber.etag,
      
      // Survey completion info
      surveyCompleted: true,
      surveyCompletedAt: new Date().toISOString(),
      lastSurveyData: JSON.stringify(updateData.surveyData || {}),
      
      // Q1 - Setting (single selection)
      Q1: (updateData.surveyData && updateData.surveyData.setting) || '',
      
      // Q2 - Profession (single selection)
      Q2: (updateData.surveyData && updateData.surveyData.profession) || '',
      
      // Q3 - Population Served (multiple selections)
      Q3: JSON.stringify((updateData.surveyData && updateData.surveyData.populations) || []),
      
      // Q4 - Interests (multiple selections)
      Q4: JSON.stringify((updateData.surveyData && updateData.surveyData.interests) || []),
      
      // Q5 - Frequency (single selection)
      Q5: (updateData.surveyData && updateData.surveyData.frequency) || '',
      
      // Q6 - Modalities (multiple selections)
      Q6: JSON.stringify((updateData.surveyData && updateData.surveyData.modalities) || []),
      
      // Free text responses (not sent to Kit.com)
      Q2_other: (updateData.surveyData && updateData.surveyData.profession_other) || '',
      Q6_other: (updateData.surveyData && updateData.surveyData.modality_other) || '',
      
      // All selected tags as JSON array (for Kit.com sync)
      allSelectedTags: JSON.stringify(updateData.selectedTags || []),
      
      // Custom responses
      customResponses: updateData.customResponses ? JSON.stringify(updateData.customResponses) : '',
      
      // Kit.com sync status
      kitSyncStatus: 'pending',
      lastUpdated: new Date().toISOString()
    };
    
    await tableClient.updateEntity(tagUpdate, 'Merge');
    console.log(`Subscriber tags updated for ${subscriberId}`);
    
  } catch (error) {
    console.error(`Error updating subscriber tags for ${subscriberId}:`, error);
    throw error;
  }
}

/**
 * Insert survey response record
 */
async function insertSurveyResponse(surveyData) {
  const tableName = process.env.SURVEY_RESPONSES_TABLE_NAME || 'surveyresponses';
  const tableClient = getTableClient(tableName);
  
  try {
    // Create unique response ID
    const responseId = `${surveyData.email}_${Date.now()}`;
    
    const surveyResponse = {
      partitionKey: surveyData.email, // Partition by email for efficient queries
      rowKey: responseId,
      therapistId: surveyData.therapistId || null,
      email: surveyData.email,
      name: surveyData.name,
      surveyData: JSON.stringify(surveyData.surveyData),
      recommendations: JSON.stringify(surveyData.recommendations || []),
      selectedTags: JSON.stringify(surveyData.selectedTags || []),
      customResponses: surveyData.customResponses ? JSON.stringify(surveyData.customResponses) : '',
      completedAt: surveyData.timestamp || new Date().toISOString(),
      completed: surveyData.completed || false,
      kitSyncStatus: surveyData.kitSyncStatus || 'pending',
      kitSyncedAt: null,
      kitErrorMessage: null
    };
    
    await tableClient.createEntity(surveyResponse);
    console.log(`Survey response created for ${surveyData.email} with ID: ${responseId}`);
    
    return responseId;
    
  } catch (error) {
    console.error(`Error inserting survey response for ${surveyData.email}:`, error);
    throw error;
  }
}

/**
 * Update Kit.com sync status for a subscriber
 */
async function updateKitSyncStatus(email, status, responseId = null) {
  const subscriberTableName = process.env.SUBSCRIBER_TABLE_NAME || 'subscribers';
  const surveyTableName = process.env.SURVEY_RESPONSES_TABLE_NAME || 'surveyresponses';
  
  try {
    // Update subscriber table
    const subscriberTableClient = getTableClient(subscriberTableName);
    const subscriber = await getSubscriberByEmail(email);
    
    if (subscriber) {
      const updateData = {
        partitionKey: subscriber.partitionKey,
        rowKey: subscriber.rowKey,
        etag: subscriber.etag,
        kitSyncStatus: status,
        kitSyncedAt: status === 'success' ? new Date().toISOString() : subscriber.kitSyncedAt,
        updatedAt: new Date().toISOString()
      };
      
      await subscriberTableClient.updateEntity(updateData, 'Replace');
    }
    
    // Update survey response table if responseId provided
    if (responseId) {
      const surveyTableClient = getTableClient(surveyTableName);
      
      try {
        const surveyResponse = await surveyTableClient.getEntity(email, responseId);
        
        const updateData = {
          partitionKey: email,
          rowKey: responseId,
          etag: surveyResponse.etag,
          kitSyncStatus: status,
          kitSyncedAt: status === 'success' ? new Date().toISOString() : surveyResponse.kitSyncedAt
        };
        
        await surveyTableClient.updateEntity(updateData, 'Replace');
      } catch (error) {
        console.error(`Could not update survey response ${responseId}:`, error);
      }
    }
    
    console.log(`Updated Kit.com sync status to ${status} for ${email}`);
    
  } catch (error) {
    console.error(`Error updating Kit.com sync status for ${email}:`, error);
    throw error;
  }
}

/**
 * Get subscriber tags organized by question
 */
async function getSubscriberTags(email) {
  try {
    const subscriber = await getSubscriberByEmail(email);
    
    if (!subscriber) {
      return {
        email: email,
        tags: [],
        tagsByQuestion: {},
        lastUpdated: null,
        surveyCompleted: false
      };
    }
    
    const tags = [];
    const tagsByQuestion = {};
    
    // Extract Q1 - Setting (single tag)
    if (subscriber.Q1) {
      tags.push(subscriber.Q1);
      tagsByQuestion.Q1 = subscriber.Q1;
    }
    
    // Extract Q2 - Profession (single tag)
    if (subscriber.Q2) {
      tags.push(subscriber.Q2);
      tagsByQuestion.Q2 = subscriber.Q2;
    }
    
    // Extract Q3 - Population (multiple tags)
    if (subscriber.Q3) {
      try {
        const q3Tags = JSON.parse(subscriber.Q3);
        tags.push(...q3Tags);
        tagsByQuestion.Q3 = q3Tags;
      } catch (e) {
        console.error('Error parsing Q3 tags:', e);
        tagsByQuestion.Q3 = [];
      }
    }
    
    // Extract Q4 - Interests (multiple tags)
    if (subscriber.Q4) {
      try {
        const q4Tags = JSON.parse(subscriber.Q4);
        tags.push(...q4Tags);
        tagsByQuestion.Q4 = q4Tags;
      } catch (e) {
        console.error('Error parsing Q4 tags:', e);
        tagsByQuestion.Q4 = [];
      }
    }
    
    // Extract Q5 - Frequency (single tag)
    if (subscriber.Q5) {
      tags.push(subscriber.Q5);
      tagsByQuestion.Q5 = subscriber.Q5;
    }
    
    // Extract Q6 - Modalities (multiple tags)
    if (subscriber.Q6) {
      try {
        const q6Tags = JSON.parse(subscriber.Q6);
        tags.push(...q6Tags);
        tagsByQuestion.Q6 = q6Tags;
      } catch (e) {
        console.error('Error parsing Q6 tags:', e);
        tagsByQuestion.Q6 = [];
      }
    }
    
    return {
      email: email,
      tags: tags,
      tagsByQuestion: tagsByQuestion,
      freeTextResponses: {
        Q2_other: subscriber.Q2_other || '',
        Q6_other: subscriber.Q6_other || ''
      },
      allSelectedTags: subscriber.allSelectedTags ? JSON.parse(subscriber.allSelectedTags) : [],
      lastUpdated: subscriber.updatedAt || subscriber.surveyCompletedAt,
      surveyCompleted: subscriber.surveyCompleted || false,
      kitSyncStatus: subscriber.kitSyncStatus || 'pending'
    };
    
  } catch (error) {
    console.error(`Error getting subscriber tags for ${email}:`, error);
    throw error;
  }
}

/**
 * Get failed Kit.com syncs for retry
 */
async function getFailedKitSyncs(limit = 50) {
  const tableName = process.env.SUBSCRIBER_TABLE_NAME || 'subscribers';
  const tableClient = getTableClient(tableName);
  
  try {
    const failedSyncs = [];
    const entities = tableClient.listEntities({
      filter: "kitSyncStatus eq 'failed'",
      select: ['email', 'allSelectedTags', 'surveyCompletedAt']
    });
    
    let count = 0;
    for await (const entity of entities) {
      if (count >= limit) break;
      failedSyncs.push({
        email: entity.email,
        tags: entity.allSelectedTags ? JSON.parse(entity.allSelectedTags) : [],
        completedAt: entity.surveyCompletedAt
      });
      count++;
    }
    
    return failedSyncs;
    
  } catch (error) {
    console.error('Error getting failed Kit.com syncs:', error);
    throw error;
  }
}

/**
 * Test connection to Azure Table Storage
 */
async function testConnection() {
  try {
    const serviceClient = initializeTableClient();
    // Try to list tables to test connection
    const tables = serviceClient.listTables();
    
    // Just get the first result to test connectivity
    for await (const table of tables) {
      console.log('Connected to Azure Table Storage successfully');
      return true;
    }
    
    return true;
  } catch (error) {
    console.error('Azure Table Storage connection test failed:', error);
    return false;
  }
}

/**
 * Get all tags for a specific user
 */
async function getUserTags(email) {
  try {
    const tableClient = getTableClient(process.env.SUBSCRIBER_TABLE_NAME || 'subscribers');
    
    // Query for subscriber by email
    const subscriberEntities = tableClient.listEntities({
      filter: `email eq '${email}'`
    });
    
    const subscribers = [];
    for await (const entity of subscriberEntities) {
      subscribers.push(entity);
    }
    
    if (subscribers.length === 0) {
      return [];
    }
    
    const subscriber = subscribers[0];
    const tags = [];
    
    // Extract tags from subscriber entity
    // Look for all tag-related fields (those starting with tag_)
    for (const [key, value] of Object.entries(subscriber)) {
      if (key.startsWith('tag_') && value) {
        tags.push({
          tagName: value,
          email: email,
          tagSource: 'survey',
          createdAt: subscriber.timestamp || new Date().toISOString()
        });
      }
    }
    
    return tags;
  } catch (error) {
    console.error('Error getting user tags:', error);
    throw error;
  }
}

module.exports = {
  ensureTablesExist,
  getSubscriberByEmail,
  updateSubscriberTags,
  updateQuestionAnswer,
  getQuestionAnswers,
  getSurveyProgress,
  insertSurveyResponse,
  updateKitSyncStatus,
  getSubscriberTags,
  getFailedKitSyncs,
  testConnection,
  getUserTags
};
