// Shows the live category name and, after a rename, the name the report was filed under.
export const categoryLabel = (category) => {
    if (!category) return 'Uncategorized';
    return category.recordedName && category.recordedName !== category.name
        ? `${category.name} (filed as '${category.recordedName}')`
        : category.name;
};
