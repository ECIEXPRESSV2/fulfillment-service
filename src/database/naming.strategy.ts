import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

export class SnakeCaseNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  columnName(propertyName: string, customName: string | undefined): string {
    if (customName) return customName;
    return propertyName.replace(/([A-Z])/g, '_$1').toLowerCase();
  }

  tableName(targetName: string, userSpecifiedName: string | undefined): string {
    if (userSpecifiedName) return userSpecifiedName;
    return targetName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  }

  relationName(propertyName: string): string {
    return propertyName.replace(/([A-Z])/g, '_$1').toLowerCase();
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return `${this.columnName(relationName, undefined)}_${referencedColumnName}`;
  }

  joinTableName(firstTableName: string, secondTableName: string): string {
    return `${firstTableName}_${secondTableName}`;
  }

  joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return `${tableName}_${columnName ?? propertyName}`;
  }
}
