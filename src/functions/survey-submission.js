const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const Joi = require('joi');
const fetch = require('node-fetch');

// Initialize Table Storage clients
let surveyResponsesTable;
let userTagsTable;

function initializeTableClients() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    
    if (!connectionString) {
        throw new Error('AZURE_STORAGE_CONNECTION_STRING environment variable is required');
    }
    
    // Initialize table clients
    surveyResponsesTable = TableClient.fromConnectionString(
        connectionString, 
        process.env.SURVEY_RESPONSES_TABLE_NAME || 'surveyresponses'
    );
    
    userTagsTable = TableClient.fromConnectionString(
        connectionString, 
        process.env.USER_TAGS_TABLE_NAME || 'usertags'
    );
}

// Helper function to ensure tables exist
async function ensureTablesExist() {
    try {
        await surveyResponsesTable.createTable();
    } catch (error) {
        // Table might already exist, ignore the error
        if (error.statusCode !== 409) {
            throw error;
        }
    }
    
    try {
        await userTagsTable.createTable();
    } catch (error) {
        // Table might already exist, ignore the error
        if (error.statusCode !== 409) {
            throw error;
        }
    }
}

// Helper function to sync tags to Kit.com
async function syncTagsToKit(email, selectedTags, context) {
    const kitApiKey = process.env.KIT_API_KEY;
    const kitFormId = process.env.KIT_FORM_ID;
    
    if (!kitApiKey) {
        context.log.warn('KIT_API_KEY not configured, skipping Kit.com sync');
        return {
            status: 'skipped',
            message: 'Kit.com API key not configured'
        };
    }

    // Filter out custom text tags (role_other, mod_other) - these shouldn't be sent to Kit
    const validKitTags = selectedTags.filter(tag => !tag.includes('_other'));
    
    if (validKitTags.length === 0) {
        context.log('No valid tags to sync to Kit.com');
        return {
            status: 'skipped',
            message: 'No valid tags to sync'
        };
    }

    context.log(`Syncing ${validKitTags.length} tags to Kit.com for:`, email.substring(0, 3) + '***');

    const kitPayload = {
        email: email,
        tags: validKitTags.map(tag => ({ name: tag }))
    };

    // If we have a form ID, add it to associate the subscriber with the form
    if (kitFormId) {
        kitPayload.form_id = kitFormId;
        context.log('Including form ID:', kitFormId);
    }

    try {
        const response = await fetch('https://api.kit.com/subscribers', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${kitApiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'TherapyTools-Survey/1.0'
            },
            body: JSON.stringify(kitPayload),
            timeout: 10000 // 10 second timeout
        });

        if (response.ok) {
            const responseData = await response.json();
            context.log('Kit.com sync successful');
            return {
                status: 'success',
                message: 'Tags synced successfully to Kit.com',
                tagssynced: validKitTags.length,
                formId: kitFormId,
                kitResponse: responseData
            };
        } else {
            const errorText = await response.text();
            context.log.error(`Kit.com API error: ${response.status} - ${errorText}`);
            return {
                status: 'failed',
                message: `Kit.com API error: ${response.status}`,
                error: errorText
            };
        }
    } catch (error) {
        context.log.error('Kit.com sync failed:', error);
        return {
            status: 'failed',
            message: 'Failed to connect to Kit.com API',
            error: error.message
        };
    }
}

// Helper function to update survey response with Kit sync status
async function updateKitSyncStatus(email, rowKey, syncStatus, context) {
    try {
        const entity = {
            partitionKey: email.toLowerCase(),
            rowKey: rowKey,
            kitSyncStatus: syncStatus,
            kitSyncedAt: new Date()
        };
        
        await surveyResponsesTable.updateEntity(entity, 'Merge');
        context.log(`Updated Kit sync status to: ${syncStatus}`);
    } catch (error) {
        context.log.error('Failed to update Kit sync status:', error);
        // Don't throw error here - this is just status tracking
    }
}

// Helper function to generate a unique ID
function generateId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// Helper function to save survey response to table storage
async function saveSurveyResponse(surveyData, context) {
    const {
        name,
        email,
        surveyData: survey,
        recommendations,
        selectedTags,
        customResponses,
        timestamp,
        completed
    } = surveyData;

    const entity = {
        partitionKey: email.toLowerCase(), // Use email as partition key for easy querying
        rowKey: generateId(), // Unique row key
        therapistId: '', // TODO: Extract from user lookup when implemented
        email: email.toLowerCase(),
        name,
        surveyData: JSON.stringify(survey),
        recommendations: JSON.stringify(recommendations),
        selectedTags: JSON.stringify(selectedTags),
        customResponses: JSON.stringify(customResponses),
        completedAt: timestamp ? new Date(timestamp) : new Date(),
        completed: completed || true,
        kitSyncStatus: 'pending'
    };

    context.log('Saving survey response to table storage for:', email.substring(0, 3) + '***');
    
    try {
        const result = await surveyResponsesTable.createEntity(entity);
        context.log('Survey response saved successfully');
        return result;
    } catch (error) {
        context.log.error('Error saving survey response:', error);
        throw error;
    }
}

// Helper function to save user tags to table storage
async function saveUserTags(email, selectedTags, context) {
    const promises = selectedTags.map(async (tagName) => {
        const entity = {
            partitionKey: email.toLowerCase(),
            rowKey: tagName, // Use tag name as row key to prevent duplicates
            therapistId: '', // TODO: Extract from user lookup when implemented
            email: email.toLowerCase(),
            tagName,
            tagSource: 'survey',
            createdAt: new Date()
        };

        try {
            // Use upsertEntity to handle duplicates (update timestamp if tag exists)
            await userTagsTable.upsertEntity(entity, 'Replace');
            return { tag: tagName, status: 'success' };
        } catch (error) {
            context.log.error(`Error saving tag ${tagName}:`, error);
            return { tag: tagName, status: 'failed', error: error.message };
        }
    });

    const results = await Promise.all(promises);
    
    const successCount = results.filter(r => r.status === 'success').length;
    const failedTags = results.filter(r => r.status === 'failed');
    
    context.log(`Tags saved: ${successCount}/${selectedTags.length} successful`);
    
    if (failedTags.length > 0) {
        context.log.error('Failed to save tags:', failedTags);
    }
    
    return {
        totalTags: selectedTags.length,
        successCount,
        failedCount: failedTags.length,
        failedTags
    };
}

// Validation schema for survey submission
const surveySubmissionSchema = Joi.object({
    name: Joi.string().min(1).max(255).required(),
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
        populations: Joi.array().items(
            Joi.string().valid(
                'pop_children10u', 'pop_teens', 'pop_adults',
                'pop_couples', 'pop_families', 'pop_groups', 'pop_all_day'
            )
        ).min(1).required(),
        interests: Joi.array().items(
            Joi.string().valid(
                'interest_sandtray', 'interest_art', 'interest_feelings_wheel',
                'interest_humans', 'interest_tumbling', 'interest_jeopardy',
                'interest_bingo', 'interest_mandala'
            )
        ).min(1).required(),
        frequency: Joi.string().valid(
            'freq_daily', 'freq_weekly', 'freq_monthly', 'freq_occasionally'
        ).required(),
        modalities: Joi.array().items(
            Joi.string().valid(
                'mod_cbt', 'mod_dbt', 'mod_solutions', 'mod_expressive',
                'mod_emdr', 'mod_couples', 'mod_ifs', 'mod_eclectic', 'mod_other'
            )
        ).min(1).required(),
        profession_other: Joi.string().max(500).allow('', null).optional(),
        modality_other: Joi.string().max(500).allow('', null).optional()
    }).required(),
    recommendations: Joi.array().items(Joi.string()).optional(),
    selectedTags: Joi.array().items(Joi.string()).min(1).required(),
    customResponses: Joi.object({
        role_other: Joi.string().max(500).allow('', null).optional(),
        mod_other: Joi.string().max(500).allow('', null).optional()
    }).optional(),
    timestamp: Joi.string().isoDate().optional(),
    completed: Joi.boolean().optional()
});

// Helper function to create CORS headers
function createCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': process.env.FRONTEND_DOMAIN || '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

// Helper function to create error response
function createErrorResponse(status, message, details = null) {
    return {
        status,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            success: false,
            error: message,
            details,
            timestamp: new Date().toISOString()
        })
    };
}

// Helper function to create success response
function createSuccessResponse(data) {
    return {
        status: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            success: true,
            message: 'Survey data processed successfully',
            data,
            timestamp: new Date().toISOString()
        })
    };
}

app.http('surveySubmission', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'survey-submission',
    handler: async (request, context) => {
        context.log('Survey submission function triggered');
        
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return {
                status: 200,
                headers: createCorsHeaders()
            };
        }

        try {
            // Parse request body
            let requestBody;
            try {
                if (typeof request.body === 'string') {
                    requestBody = JSON.parse(request.body);
                } else {
                    requestBody = request.body;
                }
            } catch (parseError) {
                context.log.error('JSON parse error:', parseError);
                return createErrorResponse(400, 'Invalid JSON in request body');
            }

            // Validate request payload
            const { error, value } = surveySubmissionSchema.validate(requestBody, { 
                abortEarly: false,
                stripUnknown: true 
            });

            if (error) {
                const validationErrors = error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message,
                    value: detail.context?.value
                }));
                
                context.log.error('Validation errors:', validationErrors);
                return createErrorResponse(400, 'Validation failed', {
                    errors: validationErrors
                });
            }

            // Extract validated data
            const {
                name,
                email,
                surveyData,
                recommendations = [],
                selectedTags,
                customResponses = {},
                timestamp,
                completed = true
            } = value;

            // Initialize table clients if not already done
            if (!surveyResponsesTable || !userTagsTable) {
                initializeTableClients();
                await ensureTablesExist();
            }

            // Log the extracted data (without sensitive info)
            context.log('Processing survey for:', { 
                email: email.substring(0, 3) + '***', // Partial email for privacy
                tagsCount: selectedTags.length,
                recommendationsCount: recommendations.length,
                completed 
            });

            // Validate that selectedTags are legitimate survey tags
            const validTags = [
                // Setting tags
                'setting_inperson', 'setting_mostly_inperson', 'setting_mixed', 
                'setting_mostly_online', 'setting_online_only',
                // Profession tags
                'role_therapist', 'role_social_worker', 'role_psychologist',
                'role_school_counselor', 'role_student', 'role_clergy',
                'role_sud_counselor', 'role_peer_specialist', 'role_other',
                // Population tags
                'pop_children10u', 'pop_teens', 'pop_adults',
                'pop_couples', 'pop_families', 'pop_groups', 'pop_all_day',
                // Interest tags
                'interest_sandtray', 'interest_art', 'interest_feelings_wheel',
                'interest_humans', 'interest_tumbling', 'interest_jeopardy',
                'interest_bingo', 'interest_mandala',
                // Frequency tags
                'freq_daily', 'freq_weekly', 'freq_monthly', 'freq_occasionally',
                // Modality tags
                'mod_cbt', 'mod_dbt', 'mod_solutions', 'mod_expressive',
                'mod_emdr', 'mod_couples', 'mod_ifs', 'mod_eclectic', 'mod_other'
            ];

            const invalidTags = selectedTags.filter(tag => !validTags.includes(tag));
            if (invalidTags.length > 0) {
                context.log.error('Invalid tags found:', invalidTags);
                return createErrorResponse(400, 'Invalid tags detected', {
                    invalidTags
                });
            }

            // Save survey response to Azure Table Storage
            let surveyResponseResult;
            let surveyRowKey;
            try {
                surveyResponseResult = await saveSurveyResponse({
                    name,
                    email,
                    surveyData,
                    recommendations,
                    selectedTags,
                    customResponses,
                    timestamp,
                    completed
                }, context);
                
                // Extract row key for later status updates
                surveyRowKey = surveyResponseResult.rowKey || generateId();
            } catch (error) {
                context.log.error('Failed to save survey response:', error);
                return createErrorResponse(500, 'Failed to save survey response', {
                    error: error.message
                });
            }

            // Save user tags to Azure Table Storage
            let tagSaveResults;
            try {
                tagSaveResults = await saveUserTags(email, selectedTags, context);
            } catch (error) {
                context.log.error('Failed to save user tags:', error);
                return createErrorResponse(500, 'Failed to save user tags', {
                    error: error.message
                });
            }

            // Sync tags to Kit.com
            let kitSyncResult;
            try {
                kitSyncResult = await syncTagsToKit(email, selectedTags, context);
                
                // Update the survey response with Kit sync status
                await updateKitSyncStatus(email, surveyRowKey, kitSyncResult.status, context);
                
            } catch (error) {
                context.log.error('Kit.com sync failed:', error);
                kitSyncResult = {
                    status: 'failed',
                    message: 'Kit.com sync failed',
                    error: error.message
                };
                
                // Update survey response with failed status
                await updateKitSyncStatus(email, surveyRowKey, 'failed', context);
            }
            
            // Return success response with all results
            const responseData = {
                email,
                name,
                tagsProcessed: selectedTags.length,
                recommendationsCount: recommendations.length,
                hasCustomResponses: Object.keys(customResponses).length > 0,
                validationPassed: true,
                databaseStatus: 'success',
                tagResults: {
                    totalTags: tagSaveResults.totalTags,
                    savedTags: tagSaveResults.successCount,
                    failedTags: tagSaveResults.failedCount
                },
                kitSyncStatus: kitSyncResult.status,
                kitSyncMessage: kitSyncResult.message,
                kitTagssynced: kitSyncResult.tagssynced || 0
            };

            context.log('Survey processing completed successfully');
            return createSuccessResponse(responseData);

        } catch (error) {
            context.log.error('Unexpected error:', error);
            return createErrorResponse(500, 'Internal server error');
        }
    }
});
