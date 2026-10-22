#include <stdio.h>
#include <stdlib.h>
#include <time.h>

#define MAX 1000
#define HASH_SIZE 2003
#define CATEGORIES 4

typedef struct Application {
    int appNo;
    int panCardNo;       /* Numeric PAN ID for this classroom simulation */
    int category;        /* 0=Retail, 1=sNII, 2=bNII, 3=QIB */
    int shares;
    int allotted;
    int duplicate;
    long long remainder;
    struct Application *next;
} Application;

typedef struct Category {
    char name[20];
    int quota;
    long long demand;
    int allotted;
} Category;

typedef struct HeapItem {
    int appIndex;
    long long remainder;
} HeapItem;

Application *head = NULL;
Application *tail = NULL;
Application *apps[MAX];

int appCount = 0;
int nextAppNo = 1;
int totalShares = 0;
int lotSize = 1;
int issueCreated = 0;
int allotmentDone = 0;

Category cat[CATEGORIES] = {
    {"Retail", 0, 0, 0},
    {"sNII", 0, 0, 0},
    {"bNII", 0, 0, 0},
    {"QIB", 0, 0, 0}
};

int hashTable[HASH_SIZE];
int hashUsed[HASH_SIZE];

void setupIPO(void);
void addApplication(void);
void displayApplications(void);
void calculateAllotment(void);
void searchApplication(void);
void displayResults(void);
void freeApplications(void);
int checkPAN(int pan);
void sortApplicationsByNumber(void);
void heapPush(HeapItem heap[], int *size, HeapItem item);
HeapItem heapPop(HeapItem heap[], int *size);

/* Hash table with linear probing. Returns 1 if new, 0 if duplicate/full. */
int checkPAN(int pan)
{
    int index = pan % HASH_SIZE;
    int start = index;

    while (hashUsed[index]) {
        if (hashTable[index] == pan)
            return 0;

        index = (index + 1) % HASH_SIZE;
        if (index == start)
            return 0;
    }

    hashTable[index] = pan;
    hashUsed[index] = 1;
    return 1;
}

/* Configure IPO share count, lot size, and category quotas. */
void setupIPO(void)
{
    int newTotal, newLot, quotas[CATEGORIES], sum = 0;

    printf("Enter total shares in the IPO: ");
    if (scanf("%d", &newTotal) != 1 || newTotal <= 0) {
        printf("Invalid total shares.\n");
        return;
    }

    printf("Enter retail lot size: ");
    if (scanf("%d", &newLot) != 1 ||
        newLot <= 0 || newLot > newTotal) {
        printf("Invalid lot size.\n");
        return;
    }

    for (int i = 0; i < CATEGORIES; i++) {
        printf("Enter quota for %s: ", cat[i].name);
        if (scanf("%d", &quotas[i]) != 1 || quotas[i] < 0) {
            printf("Invalid quota.\n");
            return;
        }
        sum += quotas[i];
    }

    if (sum != newTotal) {
        printf("Error: category quotas must add up to %d.\n", newTotal);
        return;
    }

    totalShares = newTotal;
    lotSize = newLot;

    for (int i = 0; i < CATEGORIES; i++) {
        cat[i].quota = quotas[i];
        cat[i].demand = 0;
        cat[i].allotted = 0;
    }

    issueCreated = 1;
    allotmentDone = 0;
    printf("IPO setup successful.\n");
}

/* Add a new application after validating the input. */
void addApplication(void)
{
    Application *newApp;
    int pan, category, shares;

    if (!issueCreated) {
        printf("Set up the IPO first.\n");
        return;
    }

    if (appCount >= MAX) {
        printf("Application limit reached.\n");
        return;
    }

    printf("Enter numeric PAN ID: ");
    if (scanf("%d", &pan) != 1 || pan <= 0) {
        printf("Invalid PAN ID.\n");
        return;
    }

    printf("Category: 1.Retail  2.sNII  3.bNII  4.QIB: ");
    if (scanf("%d", &category) != 1 ||
        category < 1 || category > CATEGORIES) {
        printf("Invalid category.\n");
        return;
    }
    category--;

    printf("Enter shares applied for: ");
    if (scanf("%d", &shares) != 1 || shares <= 0) {
        printf("Invalid number of shares.\n");
        return;
    }

    if (category == 0 && shares % lotSize != 0) {
        printf("Retail applications must be in multiples of %d shares.\n",
               lotSize);
        return;
    }

    /* Check duplicate before storing the application. */
    if (!checkPAN(pan)) {
        printf("Duplicate PAN ID or hash table full. Application rejected.\n");
        return;
    }

    newApp = (Application *)malloc(sizeof(Application));
    if (newApp == NULL) {
        printf("Memory allocation failed.\n");
        /* Roll back the hash insertion so the PAN can be retried. */
        int index = pan % HASH_SIZE;
        while (hashUsed[index] && hashTable[index] != pan)
            index = (index + 1) % HASH_SIZE;
        if (hashUsed[index] && hashTable[index] == pan) {
            hashUsed[index] = 0;
            /* Rebuild hash table to preserve linear-probing lookup. */
            int oldValues[HASH_SIZE], oldCount = 0;
            for (int i = 0; i < HASH_SIZE; i++) {
                if (hashUsed[i])
                    oldValues[oldCount++] = hashTable[i];
            }
            for (int i = 0; i < HASH_SIZE; i++) {
                hashUsed[i] = 0;
                hashTable[i] = 0;
            }
            for (int i = 0; i < oldCount; i++) {
                int j = oldValues[i] % HASH_SIZE;
                while (hashUsed[j])
                    j = (j + 1) % HASH_SIZE;
                hashTable[j] = oldValues[i];
                hashUsed[j] = 1;
            }
        }
        return;
    }

    newApp->appNo = nextAppNo++;
    newApp->panCardNo = pan;
    newApp->category = category;
    newApp->shares = shares;
    newApp->allotted = 0;
    newApp->duplicate = 0;
    newApp->remainder = 0;
    newApp->next = NULL;

    if (head == NULL)
        head = newApp;
    else
        tail->next = newApp;

    tail = newApp;
    apps[appCount++] = newApp;

    allotmentDone = 0;
    printf("Application added successfully. Application number: %d\n",
           newApp->appNo);
}

/* Display applications in entry order. */
void displayApplications(void)
{
    Application *p = head;

    if (p == NULL) {
        printf("No applications found.\n");
        return;
    }

    printf("\n%-8s %-12s %-12s %-12s\n",
           "App No", "PAN ID", "Category", "Shares");
    printf("------------------------------------------------\n");

    while (p != NULL) {
        printf("%-8d %-12d %-12s %-12d\n",
               p->appNo, p->panCardNo, cat[p->category].name, p->shares);
        p = p->next;
    }
}

/* Sort the pointer array by application number for binary search. */
void sortApplicationsByNumber(void)
{
    for (int i = 0; i < appCount - 1; i++) {
        for (int j = 0; j < appCount - i - 1; j++) {
            if (apps[j]->appNo > apps[j + 1]->appNo) {
                Application *temp = apps[j];
                apps[j] = apps[j + 1];
                apps[j + 1] = temp;
            }
        }
    }
}

/* Search application number using binary search. */
void searchApplication(void)
{
    int target, low = 0, high, mid, found = -1;

    if (appCount == 0) {
        printf("No applications to search.\n");
        return;
    }

    printf("Enter application number to search: ");
    if (scanf("%d", &target) != 1) {
        printf("Invalid application number.\n");
        return;
    }

    sortApplicationsByNumber();
    high = appCount - 1;

    while (low <= high) {
        mid = low + (high - low) / 2;

        if (apps[mid]->appNo == target) {
            found = mid;
            break;
        } else if (apps[mid]->appNo < target) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    if (found == -1) {
        printf("Application not found.\n");
        return;
    }

    Application *a = apps[found];
    printf("\nApplication found:\n");
    printf("Application No : %d\n", a->appNo);
    printf("PAN ID         : %d\n", a->panCardNo);
    printf("Category       : %s\n", cat[a->category].name);
    printf("Shares applied : %d\n", a->shares);
    printf("Shares allotted: %d\n", a->allotted);
}

/* Max-heap: largest remainder gets the next available share unit first. */
void heapPush(HeapItem heap[], int *size, HeapItem item)
{
    int i = (*size)++;
    heap[i] = item;

    while (i > 0) {
        int parent = (i - 1) / 2;
        if (heap[parent].remainder >= heap[i].remainder)
            break;

        HeapItem temp = heap[parent];
        heap[parent] = heap[i];
        heap[i] = temp;
        i = parent;
    }
}

HeapItem heapPop(HeapItem heap[], int *size)
{
    HeapItem result = heap[0];
    heap[0] = heap[--(*size)];

    int i = 0;
    while (1) {
        int left = 2 * i + 1;
        int right = 2 * i + 2;
        int largest = i;

        if (left < *size &&
            heap[left].remainder > heap[largest].remainder)
            largest = left;
        if (right < *size &&
            heap[right].remainder > heap[largest].remainder)
            largest = right;
        if (largest == i)
            break;

        HeapItem temp = heap[i];
        heap[i] = heap[largest];
        heap[largest] = temp;
        i = largest;
    }

    return result;
}

/* Calculate allotment for each category independently. */
void calculateAllotment(void)
{
    int indices[MAX], count[CATEGORIES] = {0};
    int eligible[MAX], eligibleCount;
    long long categoryDemand[CATEGORIES] = {0};

    if (!issueCreated) {
        printf("Set up the IPO first.\n");
        return;
    }
    if (appCount == 0) {
        printf("Add applications first.\n");
        return;
    }

    for (int i = 0; i < CATEGORIES; i++)
        cat[i].demand = cat[i].allotted = 0;

    for (int i = 0; i < appCount; i++) {
        apps[i]->allotted = 0;
        apps[i]->remainder = 0;
        categoryDemand[apps[i]->category] += apps[i]->shares;
        count[apps[i]->category]++;
    }

    for (int c = 0; c < CATEGORIES; c++)
        cat[c].demand = categoryDemand[c];

    /* Each category is allotted only from its own quota. */
    for (int c = 0; c < CATEGORIES; c++) {
        int quota = cat[c].quota;
        int groupCount = 0;

        for (int i = 0; i < appCount; i++) {
            if (apps[i]->category == c)
                indices[groupCount++] = i;
        }

        if (groupCount == 0 || quota == 0)
            continue;

        /* If demand fits, everyone receives what they requested. */
        if (categoryDemand[c] <= quota) {
            for (int j = 0; j < groupCount; j++) {
                Application *a = apps[indices[j]];
                a->allotted = a->shares;
            }
            continue;
        }

        if (c == 0) {
            /*
             * Retail lottery simulation: shuffle applicants, then give
             * one lot per selected applicant until retail quota is used.
             */
            eligibleCount = 0;
            for (int j = 0; j < groupCount; j++) {
                Application *a = apps[indices[j]];
                if (a->shares >= lotSize)
                    eligible[eligibleCount++] = indices[j];
            }

            for (int i = eligibleCount - 1; i > 0; i--) {
                int j = rand() % (i + 1);
                int temp = eligible[i];
                eligible[i] = eligible[j];
                eligible[j] = temp;
            }

            int lotsAvailable = quota / lotSize;
            for (int j = 0; j < eligibleCount && lotsAvailable > 0; j++) {
                apps[eligible[j]]->allotted = lotSize;
                lotsAvailable--;
            }
        } else {
            /*
             * Proportionate base allotment, rounded down to lot units.
             * Max-heap distributes leftover lot units by largest remainder.
             */
            long long demand = categoryDemand[c];
            int used = 0;
            HeapItem heap[MAX];
            int heapSize = 0;

            for (int j = 0; j < groupCount; j++) {
                Application *a = apps[indices[j]];
                long long numerator = (long long)a->shares * quota;
                int base = (int)(numerator / demand);
                long long rem = numerator % demand;

                /* Keep the base allotment within the application size. */
                if (base > a->shares)
                    base = a->shares;

                a->allotted = base;
                a->remainder = rem;
                used += base;

                HeapItem item;
                item.appIndex = indices[j];
                item.remainder = rem;
                heapPush(heap, &heapSize, item);
            }

            int left = quota - used;
            while (left > 0 && heapSize > 0) {
                HeapItem item = heapPop(heap, &heapSize);
                Application *a = apps[item.appIndex];

                if (a->allotted < a->shares) {
                    a->allotted++;
                    left--;
                }

                /* Reinsert only if this application can receive more. */
                if (a->allotted < a->shares) {
                    item.remainder = -1; /* no second priority in this simple model */
                    heapPush(heap, &heapSize, item);
                }
            }
        }
    }

    for (int i = 0; i < appCount; i++)
        cat[apps[i]->category].allotted += apps[i]->allotted;

    allotmentDone = 1;
    printf("Allotment calculation completed.\n");
    displayResults();
}

/* Show each investor's applied and allotted shares. */
void displayResults(void)
{
    if (!allotmentDone) {
        printf("Calculate allotment first.\n");
        return;
    }

    printf("\n%-8s %-12s %-12s %-12s %-12s\n",
           "App No", "PAN ID", "Category", "Applied", "Allotted");
    printf("---------------------------------------------------------------\n");

    for (int i = 0; i < appCount; i++) {
        Application *a = apps[i];
        printf("%-8d %-12d %-12s %-12d %-12d\n",
               a->appNo, a->panCardNo, cat[a->category].name,
               a->shares, a->allotted);
    }

    printf("\nCategory summary:\n");
    printf("%-12s %-12s %-12s %-12s\n",
           "Category", "Quota", "Demand", "Allotted");
    for (int c = 0; c < CATEGORIES; c++) {
        printf("%-12s %-12d %-12lld %-12d\n",
               cat[c].name, cat[c].quota, cat[c].demand, cat[c].allotted);
    }
}

/* Free the linked list and reset application storage. */
void freeApplications(void)
{
    Application *current = head;

    while (current != NULL) {
        Application *temp = current;
        current = current->next;
        free(temp);
    }

    head = NULL;
    tail = NULL;
    appCount = 0;
}

/* Main menu */
int main(void)
{
    int choice;

    srand((unsigned int)time(NULL));

    do {
        printf("\n===== IPO SHARE ALLOTMENT SYSTEM =====\n");
        printf("1. Set up IPO\n");
        printf("2. Add application\n");
        printf("3. Calculate allotment\n");
        printf("4. Search application\n");
        printf("5. Display applications\n");
        printf("6. Display allotment results\n");
        printf("0. Exit\n");
        printf("Enter choice: ");

        if (scanf("%d", &choice) != 1) {
            printf("Invalid input. Exiting.\n");
            break;
        }

        switch (choice) {
            case 1: setupIPO(); break;
            case 2: addApplication(); break;
            case 3: calculateAllotment(); break;
            case 4: searchApplication(); break;
            case 5: displayApplications(); break;
            case 6: displayResults(); break;
            case 0:
                freeApplications();
                printf("Program ended.\n");
                break;
            default:
                printf("Invalid choice. Try again.\n");
        }
    } while (choice != 0);

    return 0;
}
