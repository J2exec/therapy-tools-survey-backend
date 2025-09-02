# Azure Function App Deployment Setup Script
# Run this script to set up your Azure Function App for deployment

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$true)]
    [string]$FunctionAppName,
    
    [Parameter(Mandatory=$true)]
    [string]$StorageAccountName,
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "East US",
    
    [Parameter(Mandatory=$false)]
    [string]$SubscriptionId
)

Write-Host "🚀 Setting up Azure Function App for Therapy Tools Survey Hub" -ForegroundColor Green

# Login to Azure if not already logged in
try {
    $context = Get-AzContext
    if (!$context) {
        Write-Host "Please log in to Azure..." -ForegroundColor Yellow
        Connect-AzAccount
    }
} catch {
    Write-Host "Please install Azure PowerShell module: Install-Module -Name Az" -ForegroundColor Red
    exit 1
}

# Set subscription if provided
if ($SubscriptionId) {
    Write-Host "Setting subscription to: $SubscriptionId" -ForegroundColor Yellow
    Set-AzContext -SubscriptionId $SubscriptionId
}

# Create Resource Group
Write-Host "Creating resource group: $ResourceGroupName" -ForegroundColor Yellow
try {
    $rg = Get-AzResourceGroup -Name $ResourceGroupName -ErrorAction SilentlyContinue
    if (!$rg) {
        New-AzResourceGroup -Name $ResourceGroupName -Location $Location
        Write-Host "✅ Resource group created successfully" -ForegroundColor Green
    } else {
        Write-Host "✅ Resource group already exists" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Failed to create resource group: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Create Storage Account
Write-Host "Creating storage account: $StorageAccountName" -ForegroundColor Yellow
try {
    $storage = Get-AzStorageAccount -ResourceGroupName $ResourceGroupName -Name $StorageAccountName -ErrorAction SilentlyContinue
    if (!$storage) {
        New-AzStorageAccount -ResourceGroupName $ResourceGroupName -Name $StorageAccountName -Location $Location -SkuName "Standard_LRS"
        Write-Host "✅ Storage account created successfully" -ForegroundColor Green
    } else {
        Write-Host "✅ Storage account already exists" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Failed to create storage account: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Create Function App
Write-Host "Creating function app: $FunctionAppName" -ForegroundColor Yellow
try {
    $functionApp = Get-AzFunctionApp -ResourceGroupName $ResourceGroupName -Name $FunctionAppName -ErrorAction SilentlyContinue
    if (!$functionApp) {
        New-AzFunctionApp -ResourceGroupName $ResourceGroupName -Name $FunctionAppName -StorageAccountName $StorageAccountName -Runtime Node -RuntimeVersion 20 -FunctionsVersion 4 -Location $Location
        Write-Host "✅ Function app created successfully" -ForegroundColor Green
    } else {
        Write-Host "✅ Function app already exists" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Failed to create function app: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n🎉 Azure resources created successfully!" -ForegroundColor Green
Write-Host "`n📋 Next Steps:" -ForegroundColor Cyan
Write-Host "1. Set up your Azure Storage connection string in the Function App settings" -ForegroundColor White
Write-Host "2. Ensure your existing 'subscribers' table is accessible" -ForegroundColor White
Write-Host "3. Add your Kit.com API key to the Function App settings" -ForegroundColor White
Write-Host "4. Configure CORS settings for your frontend domain" -ForegroundColor White
Write-Host "5. Deploy your function code using VS Code Azure Functions extension or Azure CLI" -ForegroundColor White

Write-Host "`n🔧 Required App Settings:" -ForegroundColor Cyan
Write-Host "AZURE_STORAGE_CONNECTION_STRING=<your-storage-connection-string>" -ForegroundColor White
Write-Host "SUBSCRIBER_TABLE_NAME=subscribers" -ForegroundColor White
Write-Host "SURVEY_RESPONSES_TABLE_NAME=surveyresponses" -ForegroundColor White
Write-Host "KIT_API_KEY=<your-kit-api-key>" -ForegroundColor White
Write-Host "FRONTEND_DOMAIN=<your-frontend-domain>" -ForegroundColor White

Write-Host "`nFunction App URL: https://$FunctionAppName.azurewebsites.net" -ForegroundColor Green
