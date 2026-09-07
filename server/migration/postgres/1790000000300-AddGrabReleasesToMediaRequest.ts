import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGrabReleasesToMediaRequest1790000000300
  implements MigrationInterface
{
  name = 'AddGrabReleasesToMediaRequest1790000000300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD "grabReleases" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_request" DROP COLUMN "grabReleases"`
    );
  }
}
